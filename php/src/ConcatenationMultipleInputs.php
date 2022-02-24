<?php

require './vendor/autoload.php';

require_once('./common/ConfigProvider.php');

use BitmovinApiSdk\BitmovinApi;
use BitmovinApiSdk\Common\BitmovinApiException;
use BitmovinApiSdk\Common\Logging\ConsoleLogger;
use BitmovinApiSdk\Configuration;
use BitmovinApiSdk\Models\AacAudioConfiguration;
use BitmovinApiSdk\Models\AclEntry;
use BitmovinApiSdk\Models\AclPermission;
use BitmovinApiSdk\Models\CodecConfiguration;
use BitmovinApiSdk\Models\ConcatenationInputConfiguration;
use BitmovinApiSdk\Models\ConcatenationInputStream;
use BitmovinApiSdk\Models\Encoding;
use BitmovinApiSdk\Models\EncodingOutput;
use BitmovinApiSdk\Models\H264VideoConfiguration;
use BitmovinApiSdk\Models\HttpInput;
use BitmovinApiSdk\Models\IngestInputStream;
use BitmovinApiSdk\Models\Input;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\Mp4Muxing;
use BitmovinApiSdk\Models\MuxingStream;
use BitmovinApiSdk\Models\Output;
use BitmovinApiSdk\Models\PresetConfiguration;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\StartEncodingRequest;
use BitmovinApiSdk\Models\Status;
use BitmovinApiSdk\Models\Stream;
use BitmovinApiSdk\Models\StreamInput;
use BitmovinApiSdk\Models\StreamSelectionMode;
use BitmovinApiSdk\Models\Task;
use BitmovinApiSdk\Models\TimeBasedTrimmingInputStream;

/**
 * This example demonstrates how to use concatenation and trimming to combine multiple input files into a single output.
 * This script is the full version of the script documented in the tutorial on concatenation and trimming
 * https://bitmovin.com/docs/encoding/tutorials/stitching-and-trimming-part-1-the-basics
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server
 *       Example: videos/1080p_Sintel.mp4
 *   <li>HTTP_INPUT_BUMPER_FILE_PATH - The path to your input file on the provided HTTP server to be concatenated before HTTP_INPUT_FILE_PATH
 *       Example: videos/bumper.mp4
 *   <li>HTTP_INPUT_PROMO_FILE_PATH - The path to your input file on the provided HTTP server to be concatenated after HTTP_INPUT_FILE_PATH
 *       Example: videos/promo.mp4
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
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

$exampleName = 'ConcatenationMultipleInputs';

$configProvider = new ConfigProvider();

try {
    $bitmovinApi = new BitmovinApi(Configuration::create()
        ->apiKey($configProvider->getBitmovinApiKey())
        // uncomment the following line if you are working with a multi-tenant account
        // ->tenantOrgId($configProvider->getBitmovinTenantOrgId())
        ->logger(new ConsoleLogger())
    );

    $encoding = createEncoding("ConcatenationMultipleInputs", "Encoding with a concatenation in MP4 muxing");

    $input = createHttpInput($configProvider->getHttpInputHost());
    $mainFilePath = $configProvider->getHttpInputFilePath();
    $bumperFilePath = $configProvider->getHttpInputBumperFilePath();
    $promoFilePath = $configProvider->getHttpInputPromoFilePath();

    $output = createS3Output(
        $configProvider->getS3OutputBucketName(),
        $configProvider->getS3OutputAccessKey(),
        $configProvider->getS3OutputSecretKey()
    );

    $h264Config = createH264VideoConfig(1080, 4800000);
    $aacConfig = createAacAudioConfig();

    $main = createIngestInputStream($encoding, $input, $mainFilePath);
    $bumper = createIngestInputStream($encoding, $input, $bumperFilePath);
    $promo = createIngestInputStream($encoding, $input, $promoFilePath);

    $mainPart1 = createTimeBasedTrimmingInputStream($encoding, $main, 10.0, 90.0);
    $mainPart2 = createTimeBasedTrimmingInputStream($encoding, $main, 109.0, 60.0);

    $bumperConfig = new ConcatenationInputConfiguration();
    $bumperConfig->inputStreamId($bumper->id);
    $bumperConfig->isMain(false);
    $bumperConfig->position(0);

    $part1Config = new ConcatenationInputConfiguration();
    $part1Config->inputStreamId($mainPart1->id);
    $part1Config->isMain(true);
    $part1Config->position(1);

    $promo1Config = new ConcatenationInputConfiguration();
    $promo1Config->inputStreamId($promo->id);
    $promo1Config->isMain(false);
    $promo1Config->position(2);

    $part2Config = new ConcatenationInputConfiguration();
    $part2Config->inputStreamId($mainPart2->id);
    $part2Config->isMain(false);
    $part2Config->position(3);

    $promo2Config = new ConcatenationInputConfiguration();
    $promo2Config->inputStreamId($promo->id);
    $promo2Config->isMain(false);
    $promo2Config->position(4);

    $allTogether = createConcatentationInputStream($encoding, array($bumperConfig, $part1Config, $promo1Config, $part2Config, $promo2Config));

    $videoStream = createStreamWithConcatenationInputStreams($encoding, $allTogether, $h264Config);
    $audioStream = createStreamWithConcatenationInputStreams($encoding, $allTogether, $aacConfig);

    createMp4Muxing($encoding, $output, "multiple-inputs-concatenation-mp4", array($videoStream, $audioStream), "video.mp4");
    $startEncodingRequest = new StartEncodingRequest();

    executeEncoding($encoding, $startEncodingRequest);
} catch (Exception $exception) {
    echo $exception;
}

/**
 * Starts the actual encoding process and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
 *
 * <p>Please note that you can also use our webhooks API instead of polling the status. For more
 * information consult the API spec:
 * https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
 *
 * @param Encoding $encoding The encoding to be started
 * @param StartEncodingRequest $startEncodingRequest The request object to be sent with the start call
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeEncoding(Encoding $encoding, StartEncodingRequest $startEncodingRequest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->encodings->start($encoding->id, $startEncodingRequest);

    do {
        sleep(5);
        $task = $bitmovinApi->encoding->encodings->status($encoding->id);
        echo 'Encoding status is ' . $task->status . ' (progress: ' . $task->progress . ' %)' . PHP_EOL;
    } while ($task->status != Status::FINISHED() && $task->status != Status::ERROR());

    if ($task->status == Status::ERROR()) {
        logTaskErrors($task);
        throw new Exception('Encoding failed');
    }

    echo 'Encoding finished successfully' . PHP_EOL;
}

/**
 * Creates an MP4 muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId
 *
 * @param Encoding $encoding The encoding to add the MP4 muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @param array $streams A list of streams to be added to the muxing
 * @param string $filename The name of the file that will be written to the output
 * @return Mp4Muxing
 * @throws BitmovinApiException
 */
function createMp4Muxing(Encoding $encoding, Output $output, string $outputPath, array $streams, string $filename): Mp4Muxing
{
    global $bitmovinApi;

    $muxing = new Mp4Muxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->fileName($filename);

    foreach ($streams as $stream)
    {
        $muxingStream = new MuxingStream();
        $muxingStream->streamId($stream->id);
        $muxing->streams[] = $muxingStream;
    }

    return $bitmovinApi->encoding->encodings->muxings->mp4->create($encoding->id, $muxing);
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
function createH264VideoConfig(int $height, int $bitrate): H264VideoConfiguration
{
    global $bitmovinApi;

    $h264Config = new H264VideoConfiguration();
    $h264Config->name("H.264 " . $height . "p " . ($bitrate / 1000) . " Mbit/s");
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
function createAacAudioConfig(): AacAudioConfiguration
{
    global $bitmovinApi;

    $aacConfig = new AacAudioConfiguration();
    $aacConfig->name("AAC 128 kbit/s");
    $aacConfig->bitrate(128000);

    return $bitmovinApi->encoding->configurations->audio->aac->create($aacConfig);
}

/**
 * Adds an audio mix input stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param Encoding $encoding The encoding to which the stream will be added
 * @param ConcatenationInputStream $concatenationInputStream The input resource providing the input file
 * @param CodecConfiguration $codecConfiguration The codec configuration to be applied to the stream
 * @return Stream
 * @throws BitmovinApiException
 */
function createStreamWithConcatenationInputStreams(Encoding $encoding, ConcatenationInputStream $concatenationInputStream, CodecConfiguration $codecConfiguration): Stream
{
    global $bitmovinApi;

    $streamInput = new StreamInput();
    $streamInput->inputStreamId($concatenationInputStream->id);

    $stream = new Stream();
    $stream->inputStreams(array($streamInput));
    $stream->codecConfigId($codecConfiguration->id);

    return $bitmovinApi->encoding->encodings->streams->create($encoding->id, $stream);
}

/**
 * Creates a TimeBasedTrimmingInputStream and adds it to an encoding.
 * The TimeBasedTrimmingInputStream is used to define a section of an IngestInputStream using an offset and a duration expressed in seconds
 *
 * <p>API endpoints:
 *     https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsTrimmingTimeBasedByEncodingId
 *
 * @param Encoding $encoding The encoding to be started
 * @param IngestInputStream $ingestInputStream The IngestInputStream instance created from the input file
 * @param float offset Defines the offset in seconds at which the encoding should start, beginning at 0.
 * @param float duration Defines how many seconds of the input will be encoded.
 * @return TimeBasedTrimmingInputStream
 * @throws BitmovinApiException
 */
function createTimeBasedTrimmingInputStream(Encoding $encoding, IngestInputStream $ingestInputStream, float $offset, float $duration): TimeBasedTrimmingInputStream
{
    global $bitmovinApi;

    $timeBasedTrimmingInputStream = new TimeBasedTrimmingInputStream();
    $timeBasedTrimmingInputStream->inputStreamId($ingestInputStream->id);
    $timeBasedTrimmingInputStream->offset($offset);
    $timeBasedTrimmingInputStream->duration($duration);

    return $bitmovinApi->encoding->encodings->inputStreams->trimming->timeBased->create($encoding->id, $timeBasedTrimmingInputStream);
}

/**
 * Creates a ConcatenationInputStream and adds it to an encoding.
 * The ConcatenationInputStream is used to define a concatenated stream from multiple input files
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsConcatenationByEncodingId
 *
 * @param Encoding $encoding The encoding to be started
 * @param array $concatenationInputs List of ConcatenationInputConfiguration which include each concatenation configuration
 * @return ConcatenationInputStream
 * @throws BitmovinApiException
 */
function createConcatentationInputStream(Encoding $encoding, array $concatenationInputs): ConcatenationInputStream
{
    global $bitmovinApi;

    $concatenationInputStream = new ConcatenationInputStream();
    $concatenationInputStream->concatenation($concatenationInputs);

    return $bitmovinApi->encoding->encodings->inputStreams->concatenation->create($encoding->id, $concatenationInputStream);
}

/**
 * Creates an IngestInputStream and adds it to an encoding
 *
 * <p>The IngestInputStream is used to define where a file to read a stream from is located
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
 *
 * @param Encoding $encoding The encoding to which the stream will be added
 * @param Input $input The input resource providing the input file
 * @param string $inputPath The path to the input file
 * @return IngestInputStream
 * @throws BitmovinApiException
 */
function createIngestInputStream(Encoding $encoding, Input $input, string $inputPath) : IngestInputStream
{
    global $bitmovinApi;

    $ingestInputStream = new IngestInputStream();
    $ingestInputStream->inputId($input->id);
    $ingestInputStream->inputPath($inputPath);
    $ingestInputStream->selectionMode(StreamSelectionMode::AUTO());

    return $bitmovinApi->encoding->encodings->inputStreams->ingest->create($encoding->id, $ingestInputStream);
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
function createS3Output(string $bucketName, string $accessKey, string $secretKey): S3Output
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
function createHttpInput(string $host): HttpInput
{
    global $bitmovinApi;

    $input = new HttpInput();
    $input->host($host);

    return $bitmovinApi->encoding->inputs->http->create($input);
}

/**
 * Creates an Encoding object. This is the base object to configure your encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
 *
 * @param string $name A name that will help you identify the encoding in our dashboard (required)
 * @param string $description description A description of the encoding (optional)
 * @return Encoding
 * @throws BitmovinApiException
 */
function createEncoding(string $name, string $description): Encoding
{
    global $bitmovinApi;

    $encoding = new Encoding();
    $encoding->name($name);
    $encoding->description($description);

    return $bitmovinApi->encoding->encodings->create($encoding);
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
function buildEncodingOutput(Output $output, string $outputPath): EncodingOutput
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
function buildAbsolutePath(string $relativePath): string
{
    global $exampleName, $configProvider;

    return $configProvider->getS3OutputBasePath() . $exampleName . DIRECTORY_SEPARATOR . trim($relativePath, DIRECTORY_SEPARATOR);
}

function logTaskErrors(Task $task)
{
    if ($task->messages == null) {
        return;
    }

    $messages = array_filter($task->messages, function ($msg) {
        return $msg->type == MessageType::ERROR();
    });

    foreach ($messages as $message) {
        echo $message->text . PHP_EOL;
    }
}
