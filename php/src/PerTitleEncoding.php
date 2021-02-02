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
use BitmovinApiSdk\Models\AutoRepresentation;
use BitmovinApiSdk\Models\CodecConfiguration;
use BitmovinApiSdk\Models\DashManifest;
use BitmovinApiSdk\Models\DashManifestDefault;
use BitmovinApiSdk\Models\DashManifestDefaultVersion;
use BitmovinApiSdk\Models\Encoding;
use BitmovinApiSdk\Models\EncodingOutput;
use BitmovinApiSdk\Models\Fmp4Muxing;
use BitmovinApiSdk\Models\H264PerTitleConfiguration;
use BitmovinApiSdk\Models\H264VideoConfiguration;
use BitmovinApiSdk\Models\HlsManifest;
use BitmovinApiSdk\Models\HlsManifestDefault;
use BitmovinApiSdk\Models\HlsManifestDefaultVersion;
use BitmovinApiSdk\Models\HttpInput;
use BitmovinApiSdk\Models\Input;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\MuxingStream;
use BitmovinApiSdk\Models\Output;
use BitmovinApiSdk\Models\PerTitle;
use BitmovinApiSdk\Models\PresetConfiguration;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\StartEncodingRequest;
use BitmovinApiSdk\Models\Status;
use BitmovinApiSdk\Models\Stream;
use BitmovinApiSdk\Models\StreamInput;
use BitmovinApiSdk\Models\StreamMode;
use BitmovinApiSdk\Models\StreamSelectionMode;
use BitmovinApiSdk\Models\Task;


/**
 * This example shows how to do a Per-Title encoding with default manifests. For more information
 * see: https://bitmovin.com/per-title-encoding/
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
 *       videos/1080p_Sintel.mp4
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
 *   <li>properties file located in the root folder of the PHP examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

$exampleName = 'PerTitleEncoding';

$configProvider = new ConfigProvider();

try {
    $bitmovinApi = new BitmovinApi(Configuration::create()
        ->apiKey($configProvider->getBitmovinApiKey())
        // uncomment the following line if you are working with a multi-tenant account
        // ->tenantOrgId($configProvider->getBitmovinTenantOrgId())        
        ->logger(new ConsoleLogger())
    );

    $encoding = createEncoding($exampleName, "Per-Title Encoding with HLS and DASH manifest");

    $input = createHttpInput($configProvider->getHttpInputHost());
    $inputFilePath = $configProvider->getHttpInputFilePath();

    $output = createS3Output(
        $configProvider->getS3OutputBucketName(),
        $configProvider->getS3OutputAccessKey(),
        $configProvider->getS3OutputSecretKey()
    );

    $h264Config = createH264Config();
    $h264Stream = createStream($encoding, $input, $inputFilePath, $h264Config, StreamMode::PER_TITLE_TEMPLATE());

    $aacConfig = createAacConfig();
    $aacStream = createStream($encoding, $input, $inputFilePath, $aacConfig, StreamMode::STANDARD());

    createFmp4Muxing($encoding, $output, 'video/{height}/{bitrate}_{uuid}', $h264Stream);
    createFmp4Muxing($encoding, $output, 'audio', $aacStream);

    executeEncoding($encoding);

    generateDashManifest($encoding, $output, '');
    generateHlsManifest($encoding, $output, '');
} catch (Exception $exception) {
    echo $exception . PHP_EOL;
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
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeEncoding(Encoding $encoding)
{
    global $bitmovinApi;

    $perTitleConfiguration = new H264PerTitleConfiguration();
    $perTitleConfiguration->autoRepresentations(new AutoRepresentation());

    $perTitle = new PerTitle();
    $perTitle->h264Configuration($perTitleConfiguration);

    $startEncodingRequest = new StartEncodingRequest();
    $startEncodingRequest->perTitle($perTitle);

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
 * Creates a DASH default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param Encoding $encoding The encoding for which the manifest should be generated
 * @param Output $output The output to which the manifest should be written
 * @param string $outputPath The path to which the manifest should be written
 * @throws BitmovinApiException
 * @throws Exception
 */
function generateDashManifest(Encoding $encoding, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $dashManifestDefault = new DashManifestDefault();
    $dashManifestDefault->encodingId($encoding->id);
    $dashManifestDefault->manifestName("stream.mpd");
    $dashManifestDefault->version(DashManifestDefaultVersion::V1());
    $dashManifestDefault->outputs([buildEncodingOutput($output, $outputPath)]);

    $dashManifestDefault = $bitmovinApi->encoding->manifests->dash->default->create($dashManifestDefault);

    executeDashManifestCreation($dashManifestDefault);
}

/**
 * Creates an HLS default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
 *
 * @param Encoding $encoding The encoding for which the manifest should be generated
 * @param Output $output The output to which the manifest should be written
 * @param string $outputPath The path to which the manifest should be written
 * @throws BitmovinApiException
 * @throws Exception
 */
function generateHlsManifest(Encoding $encoding, Output $output, string $outputPath)
{
    global $bitmovinApi;

    $hlsManifestDefault = new HlsManifestDefault();
    $hlsManifestDefault->encodingId($encoding->id);
    $hlsManifestDefault->name("master.m3u8");
    $hlsManifestDefault->manifestName("master.m3u8");
    $hlsManifestDefault->version(HlsManifestDefaultVersion::V1());
    $hlsManifestDefault->outputs([buildEncodingOutput($output, $outputPath)]);

    $hlsManifestDefault = $bitmovinApi->encoding->manifests->hls->default->create($hlsManifestDefault);

    executeHlsManifestCreation($hlsManifestDefault);
}

/**
 * Starts the DASH manifest creation and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId
 *
 * @param DashManifest $dashManifest The DASH manifest to be created
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeDashManifestCreation(DashManifest $dashManifest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->manifests->dash->start($dashManifest->id);

    do {
        sleep(1);
        $task = $bitmovinApi->encoding->manifests->dash->status($dashManifest->id);
    } while ($task->status != Status::FINISHED() && $task->status != Status::ERROR());

    if ($task->status == Status::ERROR()) {
        logTaskErrors($task);
        throw new Exception("DASH manifest creation failed.");
    }

    echo "DASH manifest creation finished successfully." . PHP_EOL;
}

/**
 * Starts the HLS manifest creation and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
 *
 * @param HlsManifest $hlsManifest The HLS manifest to be created
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeHlsManifestCreation(HlsManifest $hlsManifest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->manifests->hls->start($hlsManifest->id);

    do {
        sleep(1);
        $task = $bitmovinApi->encoding->manifests->hls->status($hlsManifest->id);
    } while ($task->status != Status::FINISHED() && $task->status != Status::ERROR());

    if ($task->status == Status::ERROR()) {
        logTaskErrors($task);
        throw new Exception("HLS manifest creation failed.");
    }

    echo "HLS manifest creation finished successfully." . PHP_EOL;
}


/**
 * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
 * adaptive streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param Encoding $encoding The encoding to add the FMP4 muxing to
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
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->segmentLength(4.0);
    $muxing->streams[] = $muxingStream;

    return $bitmovinApi->encoding->encodings->muxings->fmp4->create($encoding->id, $muxing);
}

/**
 * Creates a base H.264 video configuration. This is a base configuration, the optimal settings
 * will be automatically chosen during the Per-Title encoding process.
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
    $h264Config->name("Base H.264 video config");
    $h264Config->presetConfiguration(PresetConfiguration::VOD_STANDARD());

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
function createStream(Encoding $encoding, Input $input, string $inputPath, CodecConfiguration $codecConfiguration, StreamMode $streamMode)
{
    global $bitmovinApi;

    $streamInput = new StreamInput();
    $streamInput->inputId($input->id);
    $streamInput->inputPath($inputPath);
    $streamInput->selectionMode(StreamSelectionMode::AUTO());

    $stream = new Stream();
    $stream->inputStreams([$streamInput]);
    $stream->codecConfigId($codecConfiguration->id);
    $stream->mode($streamMode);

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
