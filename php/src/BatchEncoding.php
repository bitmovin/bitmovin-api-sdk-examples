<?php

require './vendor/autoload.php';

require_once('./common/ConfigProvider.php');

use BitmovinApiSdk\Apis\Encoding\Encodings\EncodingListQueryParams;
use BitmovinApiSdk\BitmovinApi;
use BitmovinApiSdk\Common\BitmovinApiException;
use BitmovinApiSdk\Common\Logging\ConsoleLogger;
use BitmovinApiSdk\Configuration;
use BitmovinApiSdk\Models\AacAudioConfiguration;
use BitmovinApiSdk\Models\AclEntry;
use BitmovinApiSdk\Models\AclPermission;
use BitmovinApiSdk\Models\AudioConfiguration;
use BitmovinApiSdk\Models\CodecConfiguration;
use BitmovinApiSdk\Models\Encoding;
use BitmovinApiSdk\Models\EncodingOutput;
use BitmovinApiSdk\Models\Fmp4Muxing;
use BitmovinApiSdk\Models\H264VideoConfiguration;
use BitmovinApiSdk\Models\HttpInput;
use BitmovinApiSdk\Models\Input;
use BitmovinApiSdk\Models\Message;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\MuxingStream;
use BitmovinApiSdk\Models\Output;
use BitmovinApiSdk\Models\PresetConfiguration;
use BitmovinApiSdk\Models\RetryHint;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\Status;
use BitmovinApiSdk\Models\Stream;
use BitmovinApiSdk\Models\StreamInput;
use BitmovinApiSdk\Models\Task;
use BitmovinApiSdk\Models\VideoConfiguration;

/**
 * This example demonstrates how to efficiently execute a large batch of encodings in parallel. In
 * order to keep the startup time for each encoding to a minimum, it is advisable to constantly have
 * some encodings queued. Encodings will therefore be started in a way to maintain a constant queue
 * size.
 *
 * <p>The same list of jobs will be executed on each start. In order to continue a batch after
 * restarting, you will have to extend the JobDispatcher class to use a persistent data store (e.g.
 * a database)
 *
 * <p>Be aware that our webhooks API provides a more advanced way to keep track of your encodings
 * than constantly polling their status. This approach has been chosen solely for reasons of
 * simplicity.
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 *       Example: /outputs
 * </ul>
 *
 * <p>Configuration parameters will be retrieved from these sources in the listed order:
 *
 * <ol>
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
 *   <li>properties file located in the root folder of the JavaScript examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

$exampleName = 'BatchEncoding';

$configProvider = new ConfigProvider();

/**
 * The example will strive to always keep this number of encodings in state 'queued'. Make sure
 * not to choose a size larger than your queue size limit in the Bitmovin platform, otherwise
 * encoding start calls will fail.
 */
define("TARGET_QUEUE_SIZE", 3);

/**
 * The maximum number of retries per job, in case the start call or the encoding process is not
 * successful. However, no retries will be performed after receiving an error that is considered
 * permanent. Error code 8004 (platform queue limit exceeded) will always be retried.
 */
define("MAX_RETRIES", 2);

try {
    $bitmovinApi = new BitmovinApi(Configuration::create()
        ->apiKey($configProvider->getBitmovinApiKey())
        ->logger(new ConsoleLogger())
    );

    $input = createHttpInput($configProvider->getHttpInputHost());
    $inputFilePath = $configProvider->getHttpInputFilePath();

    $output = createS3Output(
        $configProvider->getS3OutputBucketName(),
        $configProvider->getS3OutputAccessKey(),
        $configProvider->getS3OutputSecretKey()
    );

    $codecConfigs = createCodecConfigs();
    $jobDispatcher = new JobDispatcher();

    do {
        $queuedEncodingsCount = countQueuedEncodings();
        $freeSlots = TARGET_QUEUE_SIZE - $queuedEncodingsCount;

        if ($freeSlots > 0) {
            $jobsToStart = $jobDispatcher->getJobsToStart($freeSlots);

            if (sizeof($jobsToStart) > 0) {
                echo "There are currently " . $queuedEncodingsCount . " encodings queued." .
                    "Starting " . sizeof($jobsToStart) . " more to reach target queue size of " .
                    TARGET_QUEUE_SIZE . PHP_EOL;

                startEncodings($jobsToStart, $codecConfigs, $input, $output);
            } else {
                echo "No more jobs to start. Waiting for " . sizeof($jobDispatcher->getStartedJobs()) . " jobs to finish." . PHP_EOL;
            }
        } else {
            echo "There are currently " . $queuedEncodingsCount . "/" . TARGET_QUEUE_SIZE . " encodings queued. Waiting for free slots..." . PHP_EOL;
        }

        sleep(10);

        foreach ($jobDispatcher->getStartedJobs() as $job) {
            updateEncodingJob($job);

            sleep(1);
        }

    } while (!$jobDispatcher->allJobsFinished());

    echo "All encoding jobs are finished." . PHP_EOL;
    $jobDispatcher->logFailedJobs();
} catch (BitmovinApiException $exception) {
    echo $exception;
}

/**
 * This checks the status of the associated encoding of the encoding job and would update the
 * encoding job in the repository.
 *
 * @param EncodingJob $job The encoding job to update
 * @throws BitmovinApiException
 */
function updateEncodingJob(EncodingJob $job)
{
    global $bitmovinApi;

    $task = $bitmovinApi->encoding->encodings->status($job->encodingId);

    if ($task->status == Status::FINISHED()) {
        $job->status = EncodingJobStatus::SUCCESSFUL;
    } else if ($task->status == Status::ERROR()) {
        if (!isRetryableError($task)) {
            echo "Encoding " . $job->encodingId . " ('" . $job->encodingName . "') failed with a permanent error. Giving up." . PHP_EOL;
            $job->status = EncodingJobStatus::GIVEN_UP;
            $job->errorMessages[] = getErrorMessages($task);
            return;
        }
        if ($job->retryCount > MAX_RETRIES) {
            echo "Encoding " . $job->encodingId . " ('" . $job->encodingName . "') has reached the maximum number of retries. Giving up." . PHP_EOL;
            $job->status = EncodingJobStatus::GIVEN_UP;
            $job->errorMessages[] = getErrorMessages($task);
            return;
        }

        echo "Encoding " . $job->encodingId . " ('" . $job->encodingName . "') has failed. " .
            "Will attempt " . (MAX_RETRIES - $job->retryCount) . " more retries." . PHP_EOL;
        $job->retryCount++;
        $job->status = EncodingJobStatus::WAITING;
    }
}

/**
 * @param Task $task
 * @return bool
 */
function isRetryableError(Task $task)
{
    return $task->status == Status::ERROR() &&
        $task->error != null &&
        $task->error->retryHint != RetryHint::NO_RETRY();
}

/**
 * @param Task $task
 * @return array
 */
function getErrorMessages(Task $task)
{
    if ($task == null) {
        return [];
    }

    return array_map(function (Message $msg) {
        return $msg->text;
    }, array_filter($task->messages, function (Message $msg) {
        return $msg->type == MessageType::ERROR();
    }));
}

/**
 * This method will start new encodings created from {@link EncodingJob} objects and update the
 * started {@link EncodingJob} objects
 *
 * @param EncodingJob[] $jobsToStart The encoding jobs that should be started
 * @param CodecConfiguration[] $codecConfigs A list of codec configurations representing the different video- and audio
 *     renditions to be generated
 * @param Input $input The input that should be used for that encodings
 * @param Output $output The output that should be used for that encodings
 * @throws BitmovinApiException
 */
function startEncodings(array $jobsToStart, array $codecConfigs, Input $input, Output $output)
{
    global $configProvider, $bitmovinApi;

    foreach ($jobsToStart as $job) {
        if ($configProvider->isNullOrEmptyString($job->encodingId)) {
            $encoding = createAndConfigureEncoding($input,
                $job->inputFilePath,
                $codecConfigs,
                $job->encodingName,
                $output,
                $job->outputPath);

            $job->encodingId = $encoding->id;
        }

        try {
            $bitmovinApi->encoding->encodings->start($job->encodingId);
            $job->status = EncodingJobStatus::STARTED;
            echo "Encoding " . $job->encodingId . " ('" . $job->encodingName . "') has been started." . PHP_EOL;
        } catch (BitmovinApiException $exception) {
            if ($exception->getCode() == 8004) {
                echo "Encoding " . $job->encodingId . " ('" . $job->encodingName . "') could not be started because your platform limit for queued encodings has been reached. Will retry." . PHP_EOL;
                return;
            }

            $job->retryCount++;
            if ($job->retryCount > MAX_RETRIES) {
                echo "" . PHP_EOL;
                $job->status = EncodingJobStatus::GIVEN_UP;
                $job->errorMessages[] = "The encoding could not be started: " . $exception->getMessage();
            }
        }
    }

    sleep(1);
}

/**
 * Creates an Encoding object and adds a stream and a muxing for each codec configuration to it.
 * This creates a fully configured encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
 *
 * @param Input $input The input that should be used for the encoding
 * @param string $inputPath The path to the input file which should be used for the encoding
 * @param CodecConfiguration[] $codecConfigs A list of codec configurations representing the different video- and audio
 *     renditions to be generated
 * @param string $encodingName A name for the encoding
 * @param Output $output The output that should be used for the encoding
 * @param string $outputPath The path where the content will be written to
 * @return Encoding
 * @throws BitmovinApiException
 */
function createAndConfigureEncoding(Input $input, string $inputPath, array $codecConfigs, string $encodingName, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $encoding = new Encoding();
    $encoding->name = $encodingName;

    $encoding = $bitmovinApi->encoding->encodings->create($encoding);

    foreach ($codecConfigs as $codecConfig) {
        $stream = createStream($encoding, $input, $inputPath, $codecConfig);

        $muxingOutputPath = $outputPath;

        if ($codecConfig instanceof VideoConfiguration) {
            $muxingOutputPath .= "/video/" . $codecConfig->height;
        } else if ($codecConfig instanceof AudioConfiguration) {
            $muxingOutputPath .= "/audio/" . ($codecConfig->bitrate / 1000);
        }

        createFmp4Muxing($encoding, $stream, $output, $muxingOutputPath);
    }

    return $encoding;
}

/**
 * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
 * adaptive streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param Encoding $encoding The encoding to add the FMP4 muxing to
 * @param Stream $stream The stream that is associated with the muxing
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @return Fmp4Muxing
 * @throws BitmovinApiException
 * @throws Exception
 */
function createFmp4Muxing(Encoding $encoding, Stream $stream, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new Fmp4Muxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams[] = $muxingStream;
    $muxing->segmentLength = 4;

    return $bitmovinApi->encoding->encodings->muxings->fmp4->create($encoding->id, $muxing);
}

/**
 * Adds a video or audio stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param Encoding $encoding The encoding to which the stream will be added
 * @param Input $input The input resource providing the input file
 * @param string $inputPath The path to the input file
 * @param CodecConfiguration $codecConfiguration The codec configuration to be applied to the stream
 * @return Stream
 * @throws BitmovinApiException
 */
function createStream(Encoding $encoding, Input $input, string $inputPath, CodecConfiguration $codecConfiguration)
{
    global $bitmovinApi;

    $streamInput = new StreamInput();
    $streamInput->inputId($input->id);
    $streamInput->inputPath($inputPath);

    $stream = new Stream();
    $stream->inputStreams([$streamInput]);
    $stream->codecConfigId($codecConfiguration->id);

    return $bitmovinApi->encoding->encodings->streams->create($encoding->id, $stream);
}

/**
 * This method queries the encodings currently in QUEUED state and returns the total result count
 * of that query
 *
 * @return int
 * @throws BitmovinApiException
 */
function countQueuedEncodings()
{
    global $bitmovinApi;

    $q = new EncodingListQueryParams();
    $q->status(Status::QUEUED());

    $queuedEncodings = $bitmovinApi->encoding->encodings->list($q);

    return $queuedEncodings->totalCount;
}

/**
 * @return array
 * @throws BitmovinApiException
 */
function createCodecConfigs()
{
    $videoConfig480 = createH264Config(480, 800000);
    $videoConfig720 = createH264Config(720, 1200000);
    $videoConfig1080 = createH264Config(1080, 2000000);
    $audioConfig = createAacConfig();

    return [$videoConfig480, $videoConfig720, $videoConfig1080, $audioConfig];
}

/**
 * Creates a configuration for the H.264 video codec to be applied to video streams.
 *
 * <p>The output resolution is defined by setting the height to 1080 pixels. Width will be
 * determined automatically to maintain the aspect ratio of your input video.
 *
 * <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
 * proven settings for the codec. See <a
 * href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
 * to optimize your H264 codec configuration for different use-cases</a> for alternative presets.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
 *
 * @param int $height The height of the output video
 * @param int $bitrate The target bitrate of the output video
 * @return H264VideoConfiguration
 * @throws BitmovinApiException
 */
function createH264Config(int $height, int $bitrate)
{
    global $bitmovinApi;

    $h264Config = new H264VideoConfiguration();
    $h264Config->name("H.264 " . $height);
    $h264Config->presetConfiguration(PresetConfiguration::VOD_STANDARD());
    $h264Config->height($height);
    $h264Config->bitrate($bitrate);

    return $bitmovinApi->encoding->configurations->video->h264->create($h264Config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 * @return AacAudioConfiguration
 * @throws BitmovinApiException
 */
function createAacConfig()
{
    global $bitmovinApi;

    $aacConfig = new AacAudioConfiguration();
    $aacConfig->name("AAC 128 kbit/s");
    $aacConfig->bitrate(128000);

    return $bitmovinApi->encoding->configurations->audio->aac->create($aacConfig);
}

/**
 * Creates a resource representing an AWS S3 cloud storage bucket to which generated content will
 * be transferred. For alternative output methods see <a
 * href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list of
 * supported input and output storages</a>
 *
 * <p>The provided credentials need to allow <i>read</i>, <i>write</i> and <i>list</i> operations.
 * <i>delete</i> should also be granted to allow overwriting of existings files. See <a
 * href="https://bitmovin.com/docs/encoding/faqs/how-do-i-create-a-aws-s3-bucket-which-can-be-used-as-output-location">creating
 * an S3 bucket and setting permissions</a> for further information
 *
 * <p>For reasons of simplicity, a new output resource is created on each execution of this
 * example. In production use, this method should be replaced by a <a
 * href="https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/GetEncodingOutputsS3">get
 * call</a> retrieving an existing resource.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/PostEncodingOutputsS3
 *
 * @param string $bucketName The name of the S3 bucket
 * @param string $accessKey The access key of your S3 account
 * @param string $secretKey The secret key of your S3 account
 * @return S3Output
 * @throws BitmovinApiException
 */
function createS3Output(string $bucketName, string $accessKey, string $secretKey)
{
    global $bitmovinApi;

    $output = new S3Output();
    $output->bucketName($bucketName);
    $output->accessKey($accessKey);
    $output->secretKey($secretKey);

    return $bitmovinApi->encoding->outputs->s3->create($output);
}

/**
 * Creates a resource representing an HTTP server providing the input files. For alternative input
 * methods see <a
 * href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list of
 * supported input and output storages</a>
 *
 * <p>For reasons of simplicity, a new input resource is created on each execution of this
 * example. In production use, this method should be replaced by a <a
 * href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId">get
 * call</a> to retrieve an existing resource.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp
 *
 * @param string $host The hostname or IP address of the HTTP server e.g.: my-storage.biz
 * @return HttpInput
 * @throws BitmovinApiException
 */
function createHttpInput(string $host)
{
    global $bitmovinApi;

    $input = new HttpInput();
    $input->host($host);

    return $bitmovinApi->encoding->inputs->http->create($input);
}

/**
 * Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
 * be written to. Public read permissions will be set for the files written, so they can be
 * accessed easily via HTTP.
 *
 * @param Output $output The output resource to be used by the EncodingOutput
 * @param string $outputPath The path where the content will be written to
 * @return EncodingOutput
 * @throws Exception
 */
function buildEncodingOutput(Output $output, string $outputPath)
{
    $aclEntry = new AclEntry();
    $aclEntry->permission(AclPermission::PUBLIC_READ());

    $encodingOutput = new EncodingOutput();
    $encodingOutput->outputPath(buildAbsolutePath($outputPath));
    $encodingOutput->outputId($output->id);
    $encodingOutput->acl([$aclEntry]);

    return $encodingOutput;
}

/**
 * Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
 * name of this example and the given relative path
 *
 * <p>e.g.: /s3/base/path/exampleName/relative/path
 *
 * @param string $relativePath The relaitve path that is concatenated
 * @return string
 * @throws Exception
 */
function buildAbsolutePath(string $relativePath)
{
    global $exampleName, $configProvider;

    return $configProvider->getS3OutputBasePath() . $exampleName . DIRECTORY_SEPARATOR . trim($relativePath, DIRECTORY_SEPARATOR);
}


class JobDispatcher
{
    /**
     * @var EncodingJob[]
     */
    private $encodingJobs = [];

    /**
     * JobDispatcher constructor.
     * @throws Exception
     */
    function __construct()
    {
        global $configProvider;

        for ($i = 1; $i <= 7; $i++) {
            $encodingName = "encoding" . $i;
            $this->encodingJobs[] = new EncodingJob($configProvider->getHttpInputFilePath(),
                $encodingName,
                $encodingName);
        }
    }

    function getJobsToStart(int $limit)
    {
        return array_slice(
            array_filter($this->encodingJobs, function (EncodingJob $job) {
                return $job->status == EncodingJobStatus::WAITING;
            }), 0, $limit);
    }

    function getStartedJobs()
    {
        return array_filter($this->encodingJobs, function (EncodingJob $job) {
            return $job->status == EncodingJobStatus::STARTED;
        });
    }

    function allJobsFinished()
    {
        return sizeof(array_filter($this->encodingJobs, function (EncodingJob $job) {
                return $job->status == EncodingJobStatus::STARTED || $job->status == EncodingJobStatus::WAITING;
            })) == 0;
    }

    function logFailedJobs()
    {
        $filtered = array_filter($this->encodingJobs, function (EncodingJob $job) {
            return $job->status == EncodingJobStatus::GIVEN_UP;
        });

        foreach ($filtered as $job) {
            echo "Encoding " . $job->encodingId . " (" . $job->encodingName . ") could not be finished successfully: " . $job->errorMessages . PHP_EOL;
        }
    }
}

class EncodingJob
{
    /**
     * @var string
     */
    public $encodingName;

    /**
     * @var string
     */
    public $inputFilePath;

    /**
     * @var string
     */
    public $outputPath;

    /**
     * @var string
     */
    public $encodingId;

    /**
     * @var int
     */
    public $retryCount;

    /**
     * @var
     */
    public $status;

    /**
     * @var array
     */
    public $errorMessages = [];

    function __construct(string $inputFilePath, string $outputPath, string $encodingName)
    {
        $this->inputFilePath = $inputFilePath;
        $this->outputPath = $outputPath;
        $this->encodingName = $encodingName;
        $this->status = EncodingJobStatus::WAITING;
    }
}

class EncodingJobStatus
{
    const WAITING = 0;
    const STARTED = 1;
    const SUCCESSFUL = 2;
    const GIVEN_UP = 3;
}
