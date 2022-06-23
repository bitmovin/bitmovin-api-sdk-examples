import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi, {
  AacAudioConfiguration,
  CdnOutput,
  CodecConfiguration,
  ConsoleLogger,
  DashManifest,
  DashManifestDefault,
  DashManifestDefaultVersion,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  HlsManifest,
  HlsManifestDefault,
  HlsManifestDefaultVersion,
  HttpInput,
  Input,
  Manifest,
  ManifestGenerator,
  ManifestResource,
  MessageType,
  MuxingStream,
  Output,
  PresetConfiguration,
  StartEncodingRequest,
  Status,
  Stream,
  StreamInput,
  StreamSelectionMode,
  Task,
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how to execute an encoding using the Bitmovin Content Delivery Network
 * as output storage.
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
  logger: new ConsoleLogger(),
});

async function main() {
  const encoding = await createEncoding('Encoding with CDN Output', 'Encoding with CDN Output');

  const input = await createHttpInput(configProvider.getHttpInputHost());
  const output = await getCdnOutput();

  // ABR Ladder - H264
  const videoConfigurations = [
    await createH264VideoConfig(1280, 720, 3000000),
    await createH264VideoConfig(1280, 720, 4608000),
    await createH264VideoConfig(1920, 1080, 6144000),
    await createH264VideoConfig(1920, 1080, 7987200),
  ];

  for (const videoConfig of videoConfigurations) {
    const videoStream = await createStream(encoding, input, configProvider.getHttpInputFilePath(), videoConfig);
    await createFmp4Muxing(encoding, output, `video/${videoConfig.bitrate}`, videoStream);
  }

  const aacAudioConfigurations = [await createAacAudioConfig(192000), await createAacAudioConfig(64000)];

  for (const audioConfig of aacAudioConfigurations) {
    const audioStream = await createStream(encoding, input, configProvider.getHttpInputFilePath(), audioConfig);
    await createFmp4Muxing(encoding, output, `audio/${audioConfig.bitrate}`, audioStream);
  }

  const dashManifest = await createDefaultDashManifest(encoding, output, '/');
  const hlsManifest = await createDefaultHlsManifest(encoding, output, '/');

  const startEncodingRequest = new StartEncodingRequest({
    manifestGenerator: ManifestGenerator.V2,
    vodDashManifests: [buildManifestResource(dashManifest)],
    vodHlsManifests: [buildManifestResource(hlsManifest)],
  });

  await executeEncoding(encoding, startEncodingRequest);

  const encodingOutputPaths = await bitmovinApi.encoding.encodings.outputPaths.get(encoding.id!)

  encodingOutputPaths.forEach(encodingOutputPath => {
    encodingOutputPath.paths?.dashManifests?.forEach(dm => {
      console.log(`Dash Manifest: https://${output.domainName}/${dm.path}`);
    })
    encodingOutputPath.paths?.hlsManifests?.forEach(hm => {
      console.log(`HLS Manifest: https://${output.domainName}/${hm.path}`);
    })
  })
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
    description: description,
  });

  return bitmovinApi.encoding.encodings.create(encoding);
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
    codecConfigId: codecConfiguration.id,
  });

  return bitmovinApi.encoding.encodings.streams.create(encoding.id!, stream);
}

/**
 * Retrieves the singleton CdnOutput resource that exists for every organization
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/GetEncodingOutputsCdn
 */
async function getCdnOutput(): Promise<CdnOutput> {
  const cdnOutputs = await bitmovinApi.encoding.outputs.cdn.list();

  return cdnOutputs.items![0];
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
    host: host,
  });

  return bitmovinApi.encoding.inputs.http.create(input);
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
 * @param width The width of the output video
 * @param height The height of the output video
 * @param bitrate The target bitrate of the output video
 */
function createH264VideoConfig(width: number, height: number, bitrate: number): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: `H.264 ${height}p ${Math.round(bitrate / 1000)} Kbit/s`,
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: height,
    width: width,
    bitrate: bitrate,
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 *
 * @param bitrate The target bitrate for the encoded audio
 */
function createAacAudioConfig(bitrate: number): Promise<AacAudioConfiguration> {
  const config = new AacAudioConfiguration({
    name: `AAC ${Math.round(bitrate / 1000)} kbit/s`,
    bitrate: bitrate,
  });

  return bitmovinApi.encoding.configurations.audio.aac.create(config);
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
 * @param stream The stream that is associated with the muxing
 */
function createFmp4Muxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<Fmp4Muxing> {
  const muxing = new Fmp4Muxing({
    segmentLength: 4.0,
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [new MuxingStream({streamId: stream.id})],
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.id!, muxing);
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
  return new EncodingOutput({
    outputPath: outputPath,
    outputId: output.id,
  });
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
 * Creates a DASH default manifest that automatically includes all representations configured in
 * the encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
async function createDefaultDashManifest(
  encoding: Encoding,
  output: Output,
  outputPath: string
): Promise<DashManifest> {
  let dashManifestDefault = new DashManifestDefault({
    encodingId: encoding.id,
    manifestName: 'stream.mpd',
    version: DashManifestDefaultVersion.V1,
    outputs: [buildEncodingOutput(output, outputPath)],
  });

  return await bitmovinApi.encoding.manifests.dash.default.create(dashManifestDefault);
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
async function createDefaultHlsManifest(encoding: Encoding, output: Output, outputPath: string): Promise<HlsManifest> {
  let hlsManifestDefault = new HlsManifestDefault({
    encodingId: encoding.id,
    outputs: [buildEncodingOutput(output, outputPath)],
    name: 'index.m3u8',
    manifestName: 'index.m3u8',
    version: HlsManifestDefaultVersion.V1,
  });

  return await bitmovinApi.encoding.manifests.hls.default.create(hlsManifestDefault);
}

/**
 * Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
 * StartEncodingRequest manifest lists.
 *
 * @param manifest The manifest to be generated at the end of the encoding process
 */
function buildManifestResource(manifest: Manifest) {
  return new ManifestResource({
    manifestId: manifest.id,
  });
}

function logTaskErrors(task: Task): void {
  if (task.messages == undefined) {
    return;
  }
  task.messages!.filter((msg) => msg.type === MessageType.ERROR).forEach((msg) => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
