import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AdaptationSet,
  AudioAdaptationSet,
  AudioMediaInfo,
  CodecConfigType,
  CodecConfiguration,
  ConsoleLogger,
  ContentProtection,
  DashFmp4Representation,
  DashManifest,
  DashRepresentationType,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  HlsManifest,
  HttpInput,
  Manifest,
  ManifestGenerator,
  ManifestResource,
  MessageType,
  Muxing,
  MuxingStream,
  Output,
  Period,
  PresetConfiguration,
  S3Output,
  SpekeDrm,
  SpekeDrmProvider,
  StartEncodingRequest,
  Status,
  Stream,
  StreamInfo,
  StreamInput,
  StreamMode,
  StreamSelectionMode,
  Task,
  VideoAdaptationSet,
} from '@bitmovin/api-sdk';
import {join} from 'path';

/**
 * This example shows how DRM content protection can be applied to a fragmented MP4 muxing.
 * Acquisition of DRM keys is done by using the SPEKE protocol, and is configured to offer
 * compatibility with both PlayReady and Widevine on the one hand, using the MPEG-CENC
 * standard, and with Fairplay on the other hand. Separate outputs are created for both types
 * of encryption, due to them having different encryption mode. Separate manifests are also created
 * (DASH for CENC and HLS for FairPlay)
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
 *       videos/1080p_Sintel.mp4
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 *       Example: /outputs
 *   <li>DRM_CONTENT_ID - (optional) The content ID that identifies your content within the SPEKE provider
 *   <li>DRM_KEY_ID - (optional) An additional 16-byte hex key ID that could be needed for some use cases
 *   <li>DRM_FAIRPLAY_IV - The initialisation vector for the FairPlay encryption configuration
 *   <li>SPEKE_URL - The URL of the SPEKE server.
 *       Example: https://my-speke-server.com/v1.0/vod
 * </ul>
 *
 * In addition, you need the following parameters to access the SPEKE server:
 *
 * <ul>
 *   <li>For authentication with AWS IAM:
 *     <ul>
 *       <li>SPEKE_ARN  -  The role ARN allowing access to the SPEKE server</li>
 *       <li>SPEKE_GATEWAY_REGION  -  The region of the associated AWS Gateway</li>
 *     </ul>
 *   </li>
 *   <li>For basic authentication:
 *     <ul>
 *       <li>SPEKE_USERNAME  -  The username to access the SPEKE server</li>
 *       <li>SPEKE_PASSWORD  -  The password to access the SPEKE server</li>
 *     </ul>
 *   </li>
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

const WIDEVINE_SYSTEM_ID = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
const PLAYREADY_SYSTEM_ID = '9a04f079-9840-4286-ab92-e65be0885f95';
const FAIRPLAY_SYSTEM_ID = '94ce86fb-07ff-4f43-adb8-93d2fa968ca2';

const exampleName = 'DrmContentProtectionWithSpeke';
const configProvider: ConfigProvider = new ConfigProvider();
const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger(),
});

async function main() {
  const encoding: Encoding = await createEncoding(
    'SPEKE DRM protection on fMP4 muxings',
    'Example with CENC and Fairplay DRM content protection using SPEKE'
  );

  const inputFilePath = configProvider.getHttpInputFilePath();
  const input = await createHttpInput(configProvider.getHttpInputHost());
  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const h264Config = await createH264VideoConfig();
  const aacConfig = await createAacAudioConfig();

  const videoStream = await createStream(encoding, input, inputFilePath, h264Config);
  const audioStream = await createStream(encoding, input, inputFilePath, aacConfig);

  const videoMuxing = await createBaseFmp4Muxing(encoding, videoStream);
  const audioMuxing = await createBaseFmp4Muxing(encoding, audioStream);

  await createFmp4SpekeDrm(encoding, videoMuxing, output, 'video/cenc', [WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID]);
  await createFmp4SpekeDrm(encoding, audioMuxing, output, 'audio/cenc', [WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID]);

  await createFmp4SpekeDrm(encoding, videoMuxing, output, 'video/fairplay', [FAIRPLAY_SYSTEM_ID]);
  await createFmp4SpekeDrm(encoding, audioMuxing, output, 'audio/fairplay', [FAIRPLAY_SYSTEM_ID]);

  const dashManifest = await createDashManifest(encoding, output, '/');
  const hlsManifest = await createHlsManifest(encoding, output, '/');

  const startEncodingRequest = new StartEncodingRequest({
    manifestGenerator: ManifestGenerator.V2,
    vodDashManifests: [buildManifestResource(dashManifest)],
    vodHlsManifests: [buildManifestResource(hlsManifest)],
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
    description: description,
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
    host: host,
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
    secretKey: secretKey,
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
function createH264VideoConfig(): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: `H.264 1080p 1.5 Mbit/s`,
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: 1080,
    bitrate: 1_500_000,
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
    name: `AAC 128 kbit/s`,
    bitrate: 128000,
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
  input: HttpInput,
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
    mode: StreamMode.STANDARD,
  });

  return bitmovinApi.encoding.encodings.streams.create(encoding.id!, stream);
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
function createBaseFmp4Muxing(encoding: Encoding, stream: Stream): Promise<Fmp4Muxing> {
  const muxingStream = new MuxingStream({
    streamId: stream.id,
  });

  const muxing = new Fmp4Muxing({
    segmentLength: 4.0,
    streams: [muxingStream],
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.id!, muxing);
}

/**
 * Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and PlayReady
 * specific fields will be included into DASH and HLS manifests to enable key retrieval using
 * either DRM method. Encryption information is acquired from a DRM server using the SPEKE protocol
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId
 *
 * @param encoding The encoding to which the muxing belongs to
 * @param muxing The muxing to apply the encryption to
 * @param output The output resource to which the encrypted segments will be written to
 * @param outputPath The output path where the encrypted segments will be written to
 * @param systemIds The list of DRM System IDs to encrypt with
 */
function createFmp4SpekeDrm(
  encoding: Encoding,
  muxing: Muxing,
  output: Output,
  outputPath: string,
  systemIds: string[]
): Promise<SpekeDrm> {
  const provider = new SpekeDrmProvider({
    url: configProvider.getSpekeUrl(),
  });

  if (configProvider.hasParameterByKey('SPEKE_ARN')) {
    provider.roleArn = configProvider.getSpekeArn();
    provider.gatewayRegion = configProvider.getSpekeGatewayRegion();
  } else {
    provider.username = configProvider.getSpekeUsername();
    provider.password = configProvider.getSpekePassword();
  }

  const drm = new SpekeDrm({
    provider: provider,
    outputs: [buildEncodingOutput(output, outputPath)],
    systemIds: systemIds,
  });

  if (configProvider.hasParameterByKey('DRM_CONTENT_ID')) {
    drm.contentId = configProvider.getDrmContentId();
  }

  if (configProvider.hasParameterByKey('DRM_KEY_ID')) {
    drm.kid = configProvider.getDrmKeyId();
  }

  if (systemIds.includes(FAIRPLAY_SYSTEM_ID)) {
    drm.iv = configProvider.getDrmFairplayIv();
  }

  return bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.create(encoding.id!, muxing.id!, drm);
}

/**
 * Creates a DASH manifest that includes all representations configured in the encoding.
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
async function createDashManifest(encoding: Encoding, output: Output, outputPath: string): Promise<DashManifest> {
  let dashManifest = new DashManifest({
    name: 'DASH Manifest with CENC DRM',
    manifestName: 'stream.mpd',
    outputs: [buildEncodingOutput(output, outputPath)],
  });
  dashManifest = await bitmovinApi.encoding.manifests.dash.create(dashManifest);

  let period = await bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.id!, new Period());

  let videoAdaptationSet = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );
  let audioAdaptationSet = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
    dashManifest.id!,
    period.id!,
    new AudioAdaptationSet()
  );

  let muxings = await bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.id!);
  for (let muxing of muxings.items!) {
    const spekeDrms = await bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.list(encoding.id!, muxing.id!);

    for (let spekeDrm of spekeDrms.items!) {
      if (!spekeDrm.systemIds!.includes(WIDEVINE_SYSTEM_ID)) {
        continue;
      }

      const stream = await bitmovinApi.encoding.encodings.streams.get(encoding.id!, muxing.streams![0].streamId!);
      const segmentPath = removeOutputBasePath(spekeDrm.outputs![0].outputPath!);

      const representation = new DashFmp4Representation({
        encodingId: encoding.id,
        muxingId: muxing.id,
        segmentPath: segmentPath,
        type: DashRepresentationType.TEMPLATE,
      });

      const contentProtection = new ContentProtection({
        encodingId: encoding.id,
        muxingId: muxing.id,
        drmId: spekeDrm.id,
      });

      const codec = await bitmovinApi.encoding.configurations.type.get(stream.codecConfigId!);

      if (codec.type == CodecConfigType.H264) {
        await createRepresentationAndContentProtection(
          dashManifest,
          period,
          videoAdaptationSet,
          representation,
          contentProtection
        );
      } else if (codec.type == CodecConfigType.AAC) {
        await createRepresentationAndContentProtection(
          dashManifest,
          period,
          audioAdaptationSet,
          representation,
          contentProtection
        );
      }
    }
  }

  return dashManifest;
}

/**
 * Creates a HLS manifest that includes all representations configured in the encoding.
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
 *
 * @param encoding The encoding for which the manifest should be generated
 * @param output The output to which the manifest should be written
 * @param outputPath The path to which the manifest should be written
 */
async function createHlsManifest(encoding: Encoding, output: Output, outputPath: string): Promise<HlsManifest> {
  let hlsManifest = new HlsManifest({
    name: 'HLS manifest with Fairplay DRM',
    manifestName: 'master.m3u8',
    outputs: [buildEncodingOutput(output, outputPath)],
  });
  hlsManifest = await bitmovinApi.encoding.manifests.hls.create(hlsManifest);

  let muxings = await bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.id!);
  for (let i = 0; i < muxings.items?.length!; i++) {
    const muxing = muxings.items![i];

    const spekeDrms = await bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.list(encoding.id!, muxing.id!);

    for (let spekeDrm of spekeDrms.items!) {
      if (!spekeDrm.systemIds!.includes(FAIRPLAY_SYSTEM_ID)) {
        continue;
      }

      let stream = await bitmovinApi.encoding.encodings.streams.get(encoding.id!, muxing.streams![0].streamId!);
      let segmentPath = removeOutputBasePath(spekeDrm.outputs![0].outputPath!);

      let codec = await bitmovinApi.encoding.configurations.type.get(stream.codecConfigId!);
      if (codec.type == CodecConfigType.H264) {
        let streamInfo = new StreamInfo({
          encodingId: encoding.id,
          muxingId: muxing.id,
          streamId: stream.id,
          drmId: spekeDrm.id,
          audio: 'audio',
          segmentPath: segmentPath,
          uri: `video_${i}.m3u8`,
        });
        await bitmovinApi.encoding.manifests.hls.streams.create(hlsManifest.id!, streamInfo);
      } else if (codec.type == CodecConfigType.AAC) {
        let audioMediaInfo = new AudioMediaInfo({
          name: 'HLS Audio Media',
          encodingId: encoding.id,
          muxingId: muxing.id,
          streamId: stream.id,
          drmId: spekeDrm.id,
          groupId: 'audio',
          language: 'en',
          segmentPath: segmentPath,
          uri: `audio_${i}.m3u8`,
        });
        await bitmovinApi.encoding.manifests.hls.media.audio.create(hlsManifest.id!, audioMediaInfo);
      }
    }
  }

  return hlsManifest;
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
    permission: AclPermission.PUBLIC_READ,
  });

  return new EncodingOutput({
    outputPath: buildAbsolutePath(outputPath),
    outputId: output.id,
    acl: [aclEntry],
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
 * Create a relative path from an absolute path by removing S3_OUTPUT_BASE_PATH and EXAMPLE_NAME.
 * <p>e.g.: input '/s3/base/path/exampleName/relative/path'  output 'relative/path'
 *
 * @param absolutePath The relative path that is concatenated
 */
function removeOutputBasePath(absolutePath: string): string {
  const startPath = configProvider.getS3OutputBasePath() + exampleName;
  if (absolutePath.startsWith(startPath)) {
    return absolutePath.substr(startPath.length + 1);
  }

  return absolutePath;
}

/**
 * Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
 * StartEncodingRequest manifest lists.
 *
 * @param manifest The manifest to be generated at the end of the encoding process
 */
function buildManifestResource(manifest: Manifest): ManifestResource {
  return new ManifestResource({
    manifestId: manifest.id,
  });
}

function logTaskErrors(task: Task): void {
  if (task == undefined) {
    return;
  }

  task.messages!.filter((msg) => msg.type === MessageType.ERROR).forEach((msg) => console.error(msg.text));
}

async function createRepresentationAndContentProtection(
  dashManifest: DashManifest,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: DashFmp4Representation,
  contentProtection: ContentProtection
) {
  await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
    dashManifest.id!,
    period.id!,
    adaptationSet.id!,
    representation
  );
  await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.contentprotection.create(
    dashManifest.id!,
    period.id!,
    adaptationSet.id!,
    contentProtection
  );
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
