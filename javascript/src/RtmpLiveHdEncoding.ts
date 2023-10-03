import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  CodecConfiguration,
  ConsoleLogger,
  DashManifestDefault,
  DashManifestDefaultVersion,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  HlsManifestDefault,
  HlsManifestDefaultVersion,
  Input,
  LiveAutoShutdownConfiguration,
  LiveDashManifest,
  LiveEncoding,
  LiveHlsManifest,
  MessageType,
  MuxingStream,
  Output,
  PresetConfiguration,
  RtmpInput,
  S3Output,
  StartLiveChannelEncodingRequest,
  Status,
  Stream,
  StreamInput,
  StreamSelectionMode,
  Task
} from '@bitmovin/api-sdk';

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
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

const exampleName = 'RtmpLiveHdEncoding';
const streamKey = 'myStreamKey';

/**
 * Make sure to set the correct resolution of your input video, so the aspect ratio can be
 * calculated.
 */
const inputVideoWidth = 1920;
const inputVideoHeight = 1080;
const aspectRatio = inputVideoWidth / inputVideoHeight;

const maxMinutesToWaitForLiveEncodingDetails = 5;
const maxMinutesToWaitForEncodingStatus = 5;

/**
 * Automatically shutdown the live stream if there is no input anymore for a predefined number of seconds.
 */
const bytesReadTimeoutSeconds = 3600; // 1 hour

/**
 * Automatically shutdown the live stream after a predefined runtime in minutes.
 */
const streamTimeoutMinutes = 12 * 60; // 12 hours

const configProvider: ConfigProvider = new ConfigProvider();
const bitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding: Encoding = await createEncoding(exampleName, 'Live encoding with RTMP input');

  const input: RtmpInput = await getRtmpInput();
  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const h264VideoConfiguration = await createH264VideoConfig(1080, 3000000);
  const aacAudioConfiguration = await createAacAudioConfig(128000);

  const videoStream = await createStream(encoding, input, 'live', h264VideoConfiguration);
  const audioStream = await createStream(encoding, input, 'live', aacAudioConfiguration);

  await createFmp4Muxing(encoding, output, `/video/${h264VideoConfiguration.height}p`, videoStream);
  await createFmp4Muxing(encoding, output, `/audio/${aacAudioConfiguration.bitrate! / 1000}kbps`, audioStream);

  const dashManifest: DashManifestDefault = await createDefaultDashManifest(encoding, output, '/');
  const hlsManifest: HlsManifestDefault = await createDefaultHlsManifest(encoding, output, '/');

  const liveDashManifest = new LiveDashManifest({
    manifestId: dashManifest.id
  });

  const liveHlsManifest = new LiveHlsManifest({
    manifestId: hlsManifest.id
  });

  /*
  Setting the autoShutdownConfiguration is optional,
  if omitted the live encoding will not shut down automatically.
  */
  const autoShutdownConfiguration = new LiveAutoShutdownConfiguration({
    bytesReadTimeoutSeconds: bytesReadTimeoutSeconds,
    streamTimeoutMinutes: streamTimeoutMinutes
  });

  const startLiveEncodingRequest = new StartLiveChannelEncodingRequest({
    dashManifests: [liveDashManifest],
    hlsManifests: [liveHlsManifest],
    autoShutdownConfiguration: autoShutdownConfiguration,
    streamKey: streamKey
  });

  await startLiveEncodingAndWaitUntilRunning(encoding, startLiveEncodingRequest);
  const liveEncoding: LiveEncoding = await waitForLiveEncodingDetails(encoding);

  console.log('Live encoding started successfully and is ready for streaming', liveEncoding);
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
 * @param encoding The encoding that should have the expected status
 * @param expectedStatus The expected status the provided encoding should have. See {@link Status}
 */
async function waitUntilEncodingIsInState(encoding: Encoding, expectedStatus: Status) {
  const checkIntervalInSeconds = 5;
  const maxAttempts = maxMinutesToWaitForEncodingStatus * (60 / checkIntervalInSeconds);
  let attempt = 0;

  let task: Task;
  do {
    task = await bitmovinApi.encoding.encodings.status(encoding.id!);
    if (task.status === expectedStatus) {
      return;
    }
    if (task.status === Status.ERROR) {
      logTaskErrors(task);
      throw new Error('Encoding failed');
    }
    console.log(
      `Encoding status is ${task.status}. Waiting for status ${expectedStatus} (${attempt} / ${maxAttempts})`
    );
    await timeout(checkIntervalInSeconds * 1000);
  } while (attempt++ < maxAttempts);
  throw new Error(
    `Encoding did not switch to state ${expectedStatus} within ${maxMinutesToWaitForEncodingStatus} minutes. Aborting.`
  );
}

/**
 * This method starts the live encoding with HD option
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStartByEncodingId
 *
 * @param encoding The encoding that should be started and checked until it is running
 * @param startLiveEncodingRequest The request object that is sent with the start call
 */
async function startLiveEncodingAndWaitUntilRunning(
  encoding: Encoding,
  startLiveEncodingRequest: StartLiveChannelEncodingRequest
) {
  await bitmovinApi.encoding.encodings.live.hd.start(encoding.id!, startLiveEncodingRequest);
  return waitUntilEncodingIsInState(encoding, Status.RUNNING);
}

/**
 * Tries to get the live details of the encoding. It could take a few minutes until this info is
 * available.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsLiveByEncodingId
 *
 * @param encoding The encoding for which the live encoding details should be retrieved
 */
async function waitForLiveEncodingDetails(encoding: Encoding): Promise<LiveEncoding> {
  const timeoutIntervalSeconds = 5;
  let retries = 0;
  const maxRetries = (60 / timeoutIntervalSeconds) * maxMinutesToWaitForLiveEncodingDetails;

  do {
    try {
      return await bitmovinApi.encoding.encodings.live.get(encoding.id!);
    } catch (e) {
      console.log(`Failed to fetch live encoding details. Retrying... ${retries} / ${maxRetries}`);
      retries++;
      await timeout(timeoutIntervalSeconds * 1000);
    }
  } while (retries < maxRetries);
  throw new Error(`Live encoding details could not be fetched after ${maxMinutesToWaitForLiveEncodingDetails} minutes`);
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
 * Retrieves the first RTMP input. This is an automatically generated resource and read-only.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsRtmp
 */
async function getRtmpInput(): Promise<RtmpInput> {
  const resp = await bitmovinApi.encoding.inputs.rtmp.list();
  return resp.items![0];
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

/**
 * Creates a configuration for the H.264 video codec to be applied to video streams.
 *
 * <p>The output resolution is defined by setting the height to 1080 pixels. Width will be
 * determined automatically to maintain the aspect ratio of your input video.
 *
 * <p>To keep things simple, we use a quality-optimized Live preset configuration, which will apply
 * proven settings for the codec. See <a
 * href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
 * to optimize your H264 codec configuration for different use-cases</a> for alternative presets.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
 */
function createH264VideoConfig(height: number, bitrate: number): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: `H.264 ${height}p ${bitrate / (1000 * 1000)} Mbit/s`,
    presetConfiguration: PresetConfiguration.LIVE_STANDARD,
    height,
    width: Math.ceil(aspectRatio * height),
    bitrate
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 */
function createAacAudioConfig(bitrate): Promise<AacAudioConfiguration> {
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
 */
function createStream(
  encoding: Encoding,
  input: Input,
  inputPath: string,
  codecConfiguration: CodecConfiguration
): Promise<Stream> {
  const streamInput = new StreamInput({
    inputId: input.id,
    inputPath: inputPath,
    selectionMode: StreamSelectionMode.AUTO,
  });

  const stream = new Stream({
    inputStreams: [streamInput],
    codecConfigId: codecConfiguration.id
  });

  return bitmovinApi.encoding.encodings.streams.create(encoding.id!, stream);
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
function createDefaultDashManifest(
  encoding: Encoding,
  output: Output,
  outputPath: string
): Promise<DashManifestDefault> {
  let dashManifestDefault = new DashManifestDefault({
    encodingId: encoding.id,
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
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
function createDefaultHlsManifest(encoding: Encoding, output: Output, outputPath: string): Promise<HlsManifestDefault> {
  let hlsManifestDefault = new HlsManifestDefault({
    encodingId: encoding.id,
    outputs: [buildEncodingOutput(output, outputPath)],
    name: 'master.m3u8',
    version: HlsManifestDefaultVersion.V1
  });

  return bitmovinApi.encoding.manifests.hls.default.create(hlsManifestDefault);
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
