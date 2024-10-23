import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi, {
  ConsoleLogger,
  MessageType,
  S3Output,
  Status,
  Task
} from '@bitmovin/api-sdk';

/**
 * This example shows how to do a Per-Title encoding with default manifests with Encoding Templates.
 * For more information see: https://bitmovin.com/per-title-encoding/
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
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

async function main() {
  const inputFilePath = configProvider.getHttpInputFilePath();
  const outputFilePath = configProvider.getS3OutputBasePath();

  const output = await createS3Output(
      configProvider.getS3OutputBucketName(),
      configProvider.getS3OutputAccessKey(),
      configProvider.getS3OutputSecretKey()
  );

  const template: string = `metadata:
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
              inputPath: ${inputFilePath}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264
          mode: PER_TITLE_TEMPLATE
      video_h264_1080p:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: ${inputFilePath}
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
              - outputId: ${output.id}
                outputPath: ${outputFilePath}/vod_streams_encoding/{width}_{bitrate}_{uuid}/
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
              - outputId: ${output.id}
                outputPath: ${outputFilePath}/vod_streams_encoding/{bitrate}/
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
            - outputId: ${output.id}
              outputPath: ${outputFilePath}/vod_streams_encoding/
              acl:
                - permission: PRIVATE
          version: V2`;

  await executeEncoding(template);
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
 * @param bucketName The name of the S3 bucket
 * @param accessKey The access key of your S3 account
 * @param secretKey The secret key of your S3 account
 */
function createS3Output(bucketName: string, accessKey: string, secretKey: string): Promise<S3Output> {
  const s3Output = new S3Output({
    bucketName: bucketName,
    accessKey: accessKey,
    secretKey: secretKey
  });

  return bitmovinApi.encoding.outputs.s3.create(s3Output);
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
 * @param template The Encoding Template to be used for starting an encoding
 */
async function executeEncoding(template: string): Promise<void> {
  const result = await bitmovinApi.encoding.templates.start(template);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.encodings.status(result.encodingId!);
    console.log(`Encoding status is ${task.status} (progress: ${task.progress} %)`);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('Encoding failed');
  }

  console.log('Encoding finished successfully');
}

function logTaskErrors(task: Task): void {
  if (task == undefined) {
    return;
  }

  task.messages!.filter(msg => msg.type === MessageType.ERROR).forEach(msg => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
