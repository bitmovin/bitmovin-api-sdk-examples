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
use BitmovinApiSdk\Models\DashManifestDefault;
use BitmovinApiSdk\Models\DashManifestDefaultVersion;
use BitmovinApiSdk\Models\Encoding;
use BitmovinApiSdk\Models\EncodingOutput;
use BitmovinApiSdk\Models\Fmp4Muxing;
use BitmovinApiSdk\Models\H264VideoConfiguration;
use BitmovinApiSdk\Models\HlsManifestDefault;
use BitmovinApiSdk\Models\HlsManifestDefaultVersion;
use BitmovinApiSdk\Models\Input;
use BitmovinApiSdk\Models\LiveDashManifest;
use BitmovinApiSdk\Models\LiveEncoding;
use BitmovinApiSdk\Models\LiveHlsManifest;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\MuxingStream;
use BitmovinApiSdk\Models\Output;
use BitmovinApiSdk\Models\PresetConfiguration;
use BitmovinApiSdk\Models\RtmpInput;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\StartLiveEncodingRequest;
use BitmovinApiSdk\Models\Status;
use BitmovinApiSdk\Models\Stream;
use BitmovinApiSdk\Models\StreamInput;
use BitmovinApiSdk\Models\StreamSelectionMode;
use BitmovinApiSdk\Models\Task;

/**
 * This example shows how to configure and start a live encoding using default DASH and HLS
 * manifests. For more information see: https://bitmovin.com/live-encoding-live-streaming/
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 *       Example: /outputs
 * </ul>
 *
 * <p>Configuration parameters will be retrieved from these sources in the listed order: *
 *
 * <ol>
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
 *   <li>properties file located in the root folder of the PHP examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

$exampleName = 'RtmpLiveEncoding';
const STREAM_KEY = 'myStreamKey';

/**
 * Make sure to set the correct resolution of your input video, so the aspect ratio can be
 * calculated.
 */
const INPUT_VIDEO_WIDTH = 1920;
const INPUT_VIDEO_HEIGHT = 1080;
const ASPECT_RATIO = INPUT_VIDEO_WIDTH / INPUT_VIDEO_HEIGHT;

const MAX_MINUTES_TO_WAIT_FOR_LIVE_ENCODING_DETAILS = 5;
const MAX_MINUTES_TO_WAIT_FOR_ENCOIDING_STATUS = 5;

$configProvider = new ConfigProvider();

try {
    $bitmovinApi = new BitmovinApi(Configuration::create()
        ->apiKey($configProvider->getBitmovinApiKey())
        // uncomment the following line if you are working with a multi-tenant account
        // ->tenantOrgId($configProvider->getBitmovinTenantOrgId())        
        ->logger(new ConsoleLogger())
    );

    $encoding = createEncoding($exampleName, "Live encoding with RTMP input");

    $input = getRtmpInput();

    $output = createS3Output(
        $configProvider->getS3OutputBucketName(),
        $configProvider->getS3OutputAccessKey(),
        $configProvider->getS3OutputSecretKey()
    );

    $h264Config = createH264Config();
    $aacConfig = createAacConfig();

    $h264Stream = createStream($encoding, $input, 'live', $h264Config);
    $aacStream = createStream($encoding, $input, 'live', $aacConfig);

    createFmp4Muxing($encoding, $output, 'video/' . $h264Config->height . 'p', $h264Stream);
    createFmp4Muxing($encoding, $output, 'audio/' . ($aacConfig->bitrate / 1000) . "kbps", $aacStream);

    $dashManifest = createDefaultDashManifest($encoding, $output, '');
    $hlsManifest = createDefaultHlsManifest($encoding, $output, '');

    $liveDashManifest = new LiveDashManifest();
    $liveDashManifest->manifestId($dashManifest->id);

    $liveHlsManifest = new LiveHlsManifest();
    $liveHlsManifest->manifestId($hlsManifest->id);

    $startLiveEncodingRequest = new StartLiveEncodingRequest();
    $startLiveEncodingRequest->dashManifests([$liveDashManifest]);
    $startLiveEncodingRequest->hlsManifests([$liveHlsManifest]);
    $startLiveEncodingRequest->streamKey(STREAM_KEY);

    startLiveEncodingAndWaitUntilRunning($encoding, $startLiveEncodingRequest);
    $liveEncoding = waitForLiveEncodingDetails($encoding);

    echo "Live encoding is up and ready for ingest. RTMP URL: rtmp://" . $liveEncoding->encoderIp . "/live StreamKey: "
        . $liveEncoding->streamKey . PHP_EOL;

    /*
    This will enable you to shut down the live encoding from within your script.
    In production, it is naturally recommended to stop the encoding by using the Bitmovin dashboard
    or an independent API call - https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStopByEncodingId
    */
    echo 'Press Enter to shutdown...';
    readline();

    $bitmovinApi->encoding->encodings->live->stop($encoding->id);
    waitUntilEncodingIsInState($encoding, Status::FINISHED());
} catch (Exception $exception) {
    echo $exception;
}

/**
 * Tries to get the live details of the encoding. It could take a few minutes until this info is
 * available.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsLiveByEncodingId
 *
 * @param Encoding $encoding The encoding for which the live encoding details should be retrieved
 * @return LiveEncoding
 * @throws Exception
 */
function waitForLiveEncodingDetails(Encoding $encoding)
{
    global $bitmovinApi;

    echo "Waiting until live encoding details are available (max " . MAX_MINUTES_TO_WAIT_FOR_LIVE_ENCODING_DETAILS . " minutes) ..." . PHP_EOL;

    $checkIntervalInSeconds = 10;
    $maxAttempts = MAX_MINUTES_TO_WAIT_FOR_LIVE_ENCODING_DETAILS * (60 / $checkIntervalInSeconds);
    $attempt = 0;

    do {
        try {
            return $bitmovinApi->encoding->encodings->live->get($encoding->id);
        } catch (BitmovinApiException $e) {
            echo "Failed to fetch live encoding details. Retrying... " . $attempt . "/" . $maxAttempts . PHP_EOL;
            $attempt++;
            sleep($checkIntervalInSeconds);
        }
    } while ($attempt < $maxAttempts);

    throw new Exception("Failed to retrieve live encoding details within " . MAX_MINUTES_TO_WAIT_FOR_LIVE_ENCODING_DETAILS . " minutes. Aborting.");
}

/**
 * This method starts the live encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStartByEncodingId
 *
 * @param Encoding $encoding The encoding that should be started and checked until it is running
 * @param StartLiveEncodingRequest $startLiveEncodingRequest The request object that is sent with the start call
 * @throws BitmovinApiException
 */
function startLiveEncodingAndWaitUntilRunning(Encoding $encoding, StartLiveEncodingRequest $startLiveEncodingRequest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->encodings->live->start($encoding->id, $startLiveEncodingRequest);
    waitUntilEncodingIsInState($encoding, Status::RUNNING());
}

/**
 * Periodically checks the status of the encoding.
 *
 * <p>Note: You can also use our webhooks API instead of polling the status. For more information
 * checkout the API spec:
 * https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
 *
 * @param Encoding $encoding The encoding that should have the expected status
 * @param Status $expectedStatus The expected status the provided encoding should have. See {@link Status}
 * @throws BitmovinApiException
 * @throws Exception
 */
function waitUntilEncodingIsInState(Encoding $encoding, Status $expectedStatus)
{
    global $bitmovinApi;

    echo "Waiting for encoding to have " . $expectedStatus . " (max " . MAX_MINUTES_TO_WAIT_FOR_ENCOIDING_STATUS . " minutes) ..." . PHP_EOL;

    $checkIntervalInSeconds = 5;
    $maxAttempts = MAX_MINUTES_TO_WAIT_FOR_ENCOIDING_STATUS * (60 / $checkIntervalInSeconds);
    $attempt = 0;

    do {
        $task = $bitmovinApi->encoding->encodings->status($encoding->id);

        if ($task->status == Status::ERROR()) {
            throw new Exception("Error while waiting for encoding with id " . $encoding->id . " to have the status " . $expectedStatus);
        }
        if ($task->status == $expectedStatus) {
            return;
        }
        echo "Encoding status is " . $task->status . ". Waiting for status " . $expectedStatus . " (" . $attempt . " / " . $maxAttempts . ")" . PHP_EOL;
        sleep($checkIntervalInSeconds);
    } while ($attempt++ < $maxAttempts);

    throw new Exception("Live encoding did not switch to state " . $expectedStatus . " within " . MAX_MINUTES_TO_WAIT_FOR_ENCOIDING_STATUS . " minutes. Aborting.");
}

/**
 * @param Encoding $encoding
 * @param Output $output
 * @param string $outputPath
 * @return DashManifestDefault
 * @throws BitmovinApiException
 * @throws Exception
 */
function createDefaultDashManifest(Encoding $encoding, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $dashManifestDefault = new DashManifestDefault();
    $dashManifestDefault->encodingId($encoding->id);
    $dashManifestDefault->manifestName('stream.mpd');
    $dashManifestDefault->version(DashManifestDefaultVersion::V1());
    $dashManifestDefault->outputs([buildEncodingOutput($output, $outputPath)]);

    return $bitmovinApi->encoding->manifests->dash->default->create($dashManifestDefault);
}

/**
 * @param Encoding $encoding
 * @param Output $output
 * @param string $outputPath
 * @return HlsManifestDefault
 * @throws BitmovinApiException
 * @throws Exception
 */
function createDefaultHlsManifest(Encoding $encoding, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $hlsManifestDefault = new HlsManifestDefault();
    $hlsManifestDefault->encodingId($encoding->id);
    $hlsManifestDefault->manifestName('master.m3u8');
    $hlsManifestDefault->version(HlsManifestDefaultVersion::V1());
    $hlsManifestDefault->outputs([buildEncodingOutput($output, $outputPath)]);

    return $bitmovinApi->encoding->manifests->hls->default->create($hlsManifestDefault);
}

/**
 * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
 * adaptive streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param Encoding $encoding The encoding to add the MP4 muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @param Stream $stream The stream to be muxed
 * @return Fmp4Muxing
 * @throws BitmovinApiException
 * @throws Exception
 */
function createFmp4Muxing(Encoding $encoding, Output $output, string $outputPath, Stream $stream)
{
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new Fmp4Muxing();
    $muxing->segmentLength(4.0);
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams([$muxingStream]);

    return $bitmovinApi->encoding->encodings->muxings->fmp4->create($encoding->id, $muxing);
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
 * @return H264VideoConfiguration
 * @throws BitmovinApiException
 */
function createH264Config()
{
    global $bitmovinApi;

    $h264Config = new H264VideoConfiguration();
    $h264Config->name("H.264 1080p 3 Mbit/s");
    $h264Config->presetConfiguration(PresetConfiguration::LIVE_STANDARD());
    $h264Config->height(INPUT_VIDEO_HEIGHT);
    $h264Config->bitrate(3000000);
    $h264Config->width(ceil(ASPECT_RATIO * INPUT_VIDEO_HEIGHT));

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
    $streamInput->selectionMode(StreamSelectionMode::AUTO());

    $stream = new Stream();
    $stream->inputStreams([$streamInput]);
    $stream->codecConfigId($codecConfiguration->id);

    return $bitmovinApi->encoding->encodings->streams->create($encoding->id, $stream);
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
 * @return RtmpInput
 * @throws BitmovinApiException
 */
function getRtmpInput()
{
    global $bitmovinApi;

    return $bitmovinApi->encoding->inputs->rtmp->list()->items[0];
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
function createEncoding(string $name, string $description)
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
