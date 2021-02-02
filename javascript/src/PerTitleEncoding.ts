import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AutoRepresentation,
  CodecConfiguration,
  ConsoleLogger,
  DashManifestDefault,
  DashManifestDefaultVersion,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264PerTitleConfiguration,
  H264VideoConfiguration,
  HlsManifestDefault,
  HlsManifestDefaultVersion,
  HttpInput,
  Input,
  MessageType,
  MuxingStream,
  Output,
  PerTitle,
  PresetConfiguration,
  S3Output,
  StartEncodingRequest,
  Status,
  Stream,
  StreamInput,
  StreamMode,
  Task
} from '@bitmovin/api-sdk';
import {join} from 'path';

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
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

const exampleName = 'PerTitleEncoding';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding: Encoding = await createEncoding(exampleName, 'Per-Title Encoding');

  const input = await createHttpInput(configProvider.getHttpInputHost());
  const inputFilePath = configProvider.getHttpInputFilePath();

  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const h264VideoConfiguration = await createBaseH264VideoConfig();
  const aacAudioConfiguration = await createAacAudioConfig(128000);

  const videoStream = await createStream(
    encoding,
    input,
    inputFilePath,
    h264VideoConfiguration,
    StreamMode.PER_TITLE_TEMPLATE
  );
  const audioStream = await createStream(encoding, input, inputFilePath, aacAudioConfiguration, StreamMode.STANDARD);

  await createFmp4Muxing(encoding, output, 'video/{height}/{bitrate}_{uuid}', videoStream);
  await createFmp4Muxing(encoding, output, `/audio/${aacAudioConfiguration.bitrate! / 1000}kbs`, audioStream);

  const startEncodingRequest = new StartEncodingRequest({
    perTitle: new PerTitle({
      h264Configuration: new H264PerTitleConfiguration({
        autoRepresentations: new AutoRepresentation()
      })
    })
  });

  await executeEncoding(encoding, startEncodingRequest);

  await generateDashManifest(encoding, output, '/');
  await generateHlsManifest(encoding, output, '/');
}

/**
 * Creates an Encoding object. This is the base object to configure your encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
 *
 * @param name A name that will help you identify the encoding in our dashboard (required)
 * @param description A description of the encoding (optional)
 */
function createEncoding(name: string, description: string): Promise<Encoding> {
  const encoding = new Encoding({
    name: name,
    description: description
  });

  return bitmovinApi.encoding.encodings.create(encoding);
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
 * @param host The hostname or IP address of the HTTP server e.g.: my-storage.biz
 */
function createHttpInput(host: string): Promise<HttpInput> {
  const input = new HttpInput({
    host: host
  });

  return bitmovinApi.encoding.inputs.http.create(input);
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
 */
function createBaseH264VideoConfig(): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: 'Base H.264 video config',
    presetConfiguration: PresetConfiguration.VOD_STANDARD
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 */
function createAacAudioConfig(bitrate: number): Promise<AacAudioConfiguration> {
  const config = new AacAudioConfiguration({
    name: `AAC ${bitrate / 1000} kbit/s`,
    bitrate
  });

  return bitmovinApi.encoding.configurations.audio.aac.create(config);
}

/**
 * Adds a video or audio stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param encoding The encoding to which the stream will be added
 * @param input The input resource providing the input file
 * @param inputPath The path to the input file
 * @param codecConfiguration The codec configuration to be applied to the stream
 * @param streamMode The stream mode tells which type of stream this is
 */
function createStream(
  encoding: Encoding,
  input: Input,
  inputPath: string,
  codecConfiguration: CodecConfiguration,
  streamMode: StreamMode
) {
  const streamInput = new StreamInput({
    inputId: input.id,
    inputPath: inputPath
  });

  const stream = new Stream({
    inputStreams: [streamInput],
    codecConfigId: codecConfiguration.id,
    mode: streamMode
  });

  return bitmovinApi.encoding.encodings.streams.create(encoding.id!, stream);
}

/**
 * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
 * adaptive streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param encoding The encoding where to add the muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragmented segments will be written to
 * @param stream The stream to be muxed
 */
function createFmp4Muxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<Fmp4Muxing> {
  const muxingStream = new MuxingStream({
    streamId: stream.id
  });

  const muxing = new Fmp4Muxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [muxingStream],
    segmentLength: 4
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.id!, muxing);
}

/**
 * Creates a DASH default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param encodingId The encoding for which the manifest should be generated
 * @param output The output where the manifest should be written to
 * @param outputPath The path to which the manifest should be written
 */
function createDefaultDashManifest(
  encodingId: string,
  output: Output,
  outputPath: string
): Promise<DashManifestDefault> {
  let dashManifestDefault = new DashManifestDefault({
    encodingId: encodingId,
    manifestName: 'stream.mpd',
    version: DashManifestDefaultVersion.V1,
    outputs: [buildEncodingOutput(output, outputPath)]
  });

  return bitmovinApi.encoding.manifests.dash.default.create(dashManifestDefault);
}

/**
 * Creates an HLS default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
 *
 * @param encodingId The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
function createDefaultHlsManifest(encodingId: string, output: Output, outputPath: string): Promise<HlsManifestDefault> {
  let hlsManifestDefault = new HlsManifestDefault({
    encodingId: encodingId,
    outputs: [buildEncodingOutput(output, outputPath)],
    name: 'master.m3u8',
    version: HlsManifestDefaultVersion.V1
  });

  return bitmovinApi.encoding.manifests.hls.default.create(hlsManifestDefault);
}

/**
 * Creates a DASH default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output where the manifest should be written to
 * @param outputPath The path to which the manifest should be written
 */
async function generateDashManifest(encoding: Encoding, output: Output, outputPath: string): Promise<void> {
  const dashManifestDefault = await createDefaultDashManifest(encoding.id!, output, outputPath);
  return executeDashManifestCreation(dashManifestDefault);
}

/**
 * Creates an HLS default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
 *
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
async function generateHlsManifest(encoding: Encoding, output: Output, outputPath: string): Promise<void> {
  const hlsManifestDefault = await createDefaultHlsManifest(encoding.id!, output, outputPath);
  return executeHlsManifestCreation(hlsManifestDefault);
}

/**
 * Starts the DASH manifest creation and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId
 *
 * @param dashManifest The DASH manifest to be created
 */
async function executeDashManifestCreation(dashManifest: DashManifestDefault): Promise<void> {
  await bitmovinApi.encoding.manifests.dash.start(dashManifest.id!);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.manifests.dash.status(dashManifest.id!);
    console.log(`DASH manifest status is ${task.status} (progress: ${task.progress} %)`);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('DASH manifest creation failed');
  }

  console.log('DASH manifest creation finished successfully');
}

/**
 * Starts the HLS manifest creation and periodically polls its status until it reaches a final
 * state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
 *
 * @param hlsManifest The HLS manifest to be created
 */
async function executeHlsManifestCreation(hlsManifest: HlsManifestDefault): Promise<void> {
  await bitmovinApi.encoding.manifests.hls.start(hlsManifest.id!);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.manifests.hls.status(hlsManifest.id!);
    console.log(`HLS manifest status is ${task.status} (progress: ${task.progress} %)`);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('HLS manifest creation failed');
  }

  console.log('HLS manifest creation finished successfully');
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
 * @param encoding The encoding to be started
 * @param startEncodingRequest The request object to be sent with the start call
 */
async function executeEncoding(encoding: Encoding, startEncodingRequest: StartEncodingRequest): Promise<void> {
  await bitmovinApi.encoding.encodings.start(encoding.id!, startEncodingRequest);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.encodings.status(encoding.id!);
    console.log(`Encoding status is ${task.status} (progress: ${task.progress} %)`);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('Encoding failed');
  }

  console.log('Encoding finished successfully');
}

/**
 * Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
 * be written to. Public read permissions will be set for the files written, so they can be
 * accessed easily via HTTP.
 *
 * @param output The output resource to be used by the EncodingOutput
 * @param outputPath The path where the content will be written to
 */
function buildEncodingOutput(output: Output, outputPath: string): EncodingOutput {
  const aclEntry = new AclEntry({
    permission: AclPermission.PUBLIC_READ
  });

  return new EncodingOutput({
    outputPath: buildAbsolutePath(outputPath),
    outputId: output.id,
    acl: [aclEntry]
  });
}

/**
 * Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
 * name of this example and the given relative path
 *
 * <p>e.g.: /s3/base/path/exampleName/relative/path
 *
 * @param relativePath The relative path that is concatenated
 * @return The absolute path
 */
function buildAbsolutePath(relativePath: string): string {
  return join(configProvider.getS3OutputBasePath(), exampleName, relativePath);
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
