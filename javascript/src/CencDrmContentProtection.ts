import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  CencDrm,
  CencFairPlay,
  CencWidevine,
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
  Muxing,
  MuxingStream,
  Output,
  PresetConfiguration,
  S3Output,
  StartEncodingRequest,
  Status,
  Stream,
  StreamInput,
  StreamSelectionMode,
  Task
} from '@bitmovin/api-sdk';

/**
 * This example shows how DRM content protection can be applied to a fragmented MP4 muxing. The
 * encryption is configured to be compatible with both FairPlay and Widevine, using the MPEG-CENC
 * standard.
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
 *   <li>DRM_KEY - 16 byte encryption key, represented as 32 hexadecimal characters Example:
 *       cab5b529ae28d5cc5e3e7bc3fd4a544d
 *   <li>DRM_FAIRPLAY_IV - 16 byte initialization vector, represented as 32 hexadecimal characters
 *       Example: 08eecef4b026deec395234d94218273d
 *   <li>DRM_FAIRPLAY_URI - URI of the licensing server Example:
 *       skd://userspecifc?custom=information
 *   <li>DRM_WIDEVINE_KID - 16 byte encryption key id, represented as 32 hexadecimal characters
 *       Example: 08eecef4b026deec395234d94218273d
 *   <li>DRM_WIDEVINE_PSSH - Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg==
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

const exampleName = 'CencDrmContentProtection';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding = await createEncoding(exampleName, 'Example with CENC DRM content protection');

  const input = await createHttpInput(configProvider.getHttpInputHost());
  const inputFilePath = configProvider.getHttpInputFilePath();

  const output = await createS3Output(
      configProvider.getS3OutputBucketName(),
      configProvider.getS3OutputAccessKey(),
      configProvider.getS3OutputSecretKey()
  );

  const h264VideoConfiguration = await createH264VideoConfig();
  const aacAudioConfiguration = await createAacAudioConfig();

  const videoStream = await createStream(encoding, input, inputFilePath, h264VideoConfiguration);
  const audioStream = await createStream(encoding, input, inputFilePath, aacAudioConfiguration);

  const videoMuxing = await createFmp4Muxing(encoding, videoStream);
  const audioMuxing = await createFmp4Muxing(encoding, audioStream);

  await createDrmConfig(encoding, videoMuxing, output, 'video');
  await createDrmConfig(encoding, audioMuxing, output, 'audio');

  const dashManifest = await createDefaultDashManifest(encoding, output, '/');
  const hlsManifest = await createDefaultHlsManifest(encoding, output, '/');

  const startEncodingRequest = new StartEncodingRequest({
    manifestGenerator: ManifestGenerator.V2,
    vodDashManifests: [buildManifestResource(dashManifest)],
    vodHlsManifests: [buildManifestResource(hlsManifest)]
  });

  await executeEncoding(encoding, startEncodingRequest);
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
    selectionMode: StreamSelectionMode.AUTO
  });

  const stream = new Stream({
    inputStreams: [streamInput],
    codecConfigId: codecConfiguration.id
  });

  return bitmovinApi.encoding.encodings.streams.create(encoding.id!, stream);
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
 * Creates a fragmented MP4 muxing. This will split the output into continuously numbered segments
 * of a given length for adaptive streaming. However, the unencrypted segments will not be written
 * to a permanent storage as there's no output defined for the muxing. Instead, an output needs to
 * be defined for the DRM configuration resource which will later be added to this muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param encoding The encoding to which the muxing will be added
 * @param stream The stream to be muxed
 */
function createFmp4Muxing(encoding: Encoding, stream: Stream): Promise<Fmp4Muxing> {
  const muxingStream = new MuxingStream({
    streamId: stream.id
  });

  const muxing = new Fmp4Muxing({
    streams: [muxingStream],
    segmentLength: 4
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.id!, muxing);
}

/**
 * Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and FairPlay
 * specific fields will be included into DASH and HLS manifests to enable key retrieval using
 * either DRM method.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId
 *
 * @param encoding The encoding to which the muxing belongs to
 * @param muxing The muxing to apply the encryption to
 * @param output The output resource to which the encrypted segments will be written to
 * @param outputPath The output path where the encrypted segments will be written to
 */
function createDrmConfig(encoding: Encoding, muxing: Muxing, output: Output, outputPath: string): Promise<CencDrm> {
  const widevineDrm = new CencWidevine({
    pssh: configProvider.getDrmWidevinePssh()
  });

  const cencFairPlay = new CencFairPlay({
    iv: configProvider.getDrmFairplayIv(),
    uri: configProvider.getDrmFairplayUri()
  });

  const cencDrm = new CencDrm({
    outputs: [buildEncodingOutput(output, outputPath)],
    key: configProvider.getDrmKey(),
    kid: configProvider.getDrmWidevineKid(),
    widevine: widevineDrm,
    fairPlay: cencFairPlay
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.drm.cenc.create(encoding.id!, muxing.id!, cencDrm);
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
 * <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
 * proven settings for the codec. See <a
 * href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
 * to optimize your H264 codec configuration for different use-cases</a> for alternative presets.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
 */
function createH264VideoConfig(): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: 'H.264 1080p 1.5 Mbit/s',
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: 1080,
    bitrate: 1500000
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 */
function createAacAudioConfig(): Promise<AacAudioConfiguration> {
  const config = new AacAudioConfiguration({
    name: 'AAC 128 kbit/s',
    bitrate: 128000
  });

  return bitmovinApi.encoding.configurations.audio.aac.create(config);
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
async function createDefaultDashManifest(encoding: Encoding, output: Output, outputPath: string): Promise<DashManifest> {
  let dashManifestDefault = new DashManifestDefault({
    encodingId: encoding.id,
    manifestName: 'stream.mpd',
    version: DashManifestDefaultVersion.V1,
    outputs: [buildEncodingOutput(output, outputPath)]
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
    name: 'master.m3u8',
    manifestName: 'master.m3u8',
    version: HlsManifestDefaultVersion.V1
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
    manifestId: manifest.id
  });
}

function logTaskErrors(task: Task): void {
  if (task.messages == undefined) {
    return;
  }

  task.messages!.filter(msg => msg.type === MessageType.ERROR).forEach(msg => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
