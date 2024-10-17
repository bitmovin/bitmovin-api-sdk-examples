<?php

require './vendor/autoload.php';

require_once('./common/ConfigProvider.php');

use BitmovinApiSdk\BitmovinApi;
use BitmovinApiSdk\Common\BitmovinApiException;
use BitmovinApiSdk\Common\Logging\ConsoleLogger;
use BitmovinApiSdk\Configuration;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\Status;
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

$configProvider = new ConfigProvider();

try {
  $bitmovinApi = new BitmovinApi(
    Configuration::create()
      ->apiKey($configProvider->getBitmovinApiKey())
      // uncomment the following line if you are working with a multi-tenant account
      // ->tenantOrgId($configProvider->getBitmovinTenantOrgId())        
      ->logger(new ConsoleLogger())
  );

  $inputFilePath = $configProvider->getHttpInputFilePath();
  $outputFilePath = $configProvider->getS3OutputBasePath();

  $output = createS3Output(
    $configProvider->getS3OutputBucketName(),
    $configProvider->getS3OutputAccessKey(),
    $configProvider->getS3OutputSecretKey()
  );

  $template = "metadata:
  type: VOD
  name: Standard VOD Workflow

inputs:
  https:
    streams_encoding_https_input:
      properties:
        host: bitmovin-sample-content.s3.eu-west-1.amazonaws.com
        name: Bitmovin Sample Content

configurations:
  video:
    h264:
      streams_encoding_h264:
        properties:
          name: streams_encoding_h264
          profile: MAIN
      streams_encoding_h264_1080p:
        properties:
          name: streams_encoding_h264_1080p
          profile: MAIN
          height: 1080

encodings:
  main-encoding:
    properties:
      name: Standard VOD Workflow
      encoderVersion: STABLE

    streams:
      video_h264:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: $inputFilePath
          codecConfigId: $/configurations/video/h264/streams_encoding_h264
          mode: PER_TITLE_TEMPLATE
      video_h264_1080p:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: $inputFilePath
          codecConfigId: $/configurations/video/h264/streams_encoding_h264_1080p
          mode: PER_TITLE_TEMPLATE_FIXED_RESOLUTION

    muxings:
      fmp4:
        fmp4_h264:
          properties:
            name: fmp4_h264
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264
            outputs:
              - outputId: $outputId
                outputPath: $outputFilePath/vod_streams_encoding/{width}_{bitrate}_{uuid}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s
        fmp4_h264_1080p:
          properties:
            name: fmp4_h264_1080p
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264_1080p
            outputs:
              - outputId: $outputId
                outputPath: $outputFilePath/vod_streams_encoding/{bitrate}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s

    start:
      properties:
        encodingMode: THREE_PASS
        perTitle:
          h264Configuration:
            targetQualityCrf: 25
        previewDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash
        vodDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash

manifests:
  dash:
    defaultapi:
      default-dash:
        properties:
          encodingId: $/encodings/main-encoding
          name: Template encoding default DASH manifest
          manifestName: manifest.mpd
          profile: ON_DEMAND
          outputs:
            - outputId: $outputId
              outputPath: $outputFilePath/vod_streams_encoding/
              acl:
                - permission: PRIVATE
          version: V2";

  $interpolatedTemplate = str_replace(array('$inputFilePath', '$outputId', '$outputFilePath'), array($inputFilePath, $output->id, $outputFilePath), $template);

  executeEncoding($interpolatedTemplate);
} catch (Exception $exception) {
  echo $exception . PHP_EOL;
}

/**
 * Starts the actual encoding process and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
 * https://developer.bitmovin.com/encoding/reference/getencodingencodingsstatusbyencodingid
 *
 * <p>Please note that you can also use our webhooks API instead of polling the status. For more
 * information consult the API spec:
 * https://developer.bitmovin.com/encoding/reference/getnotificationswebhooksencodingencodingsfinished
 *
 * @param string $template The Encoding Template to be used for starting an encoding
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeEncoding(string $template)
{
  global $bitmovinApi;

  $encoding = $bitmovinApi->encoding->templates->start($template);

  do {
    sleep(5);
    $task = $bitmovinApi->encoding->encodings->status($encoding->encodingId);
    echo 'Encoding status is ' . $task->status . ' (progress: ' . $task->progress . ' %)' . PHP_EOL;
  } while ($task->status != Status::FINISHED() && $task->status != Status::ERROR());

  if ($task->status == Status::ERROR()) {
    logTaskErrors($task);
    throw new Exception('Encoding failed');
  }

  echo 'Encoding finished successfully' . PHP_EOL;
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
