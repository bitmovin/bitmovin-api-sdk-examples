import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AudioMediaInfo,
  CodecConfiguration,
  ConsoleLogger,
  CustomTag,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  HlsManifest,
  HttpInput,
  Input,
  Keyframe,
  Manifest,
  ManifestGenerator,
  ManifestResource,
  MessageType,
  MuxingStream,
  Output,
  PositionMode,
  PresetConfiguration,
  S3Output,
  StartEncodingRequest,
  Status,
  Stream,
  StreamInfo,
  StreamInput,
  Task,
  VideoConfiguration
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how to create multiple fMP4 renditions with Server-Side Ad Insertion
 * (SSAI)
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

const exampleName = 'ServerSideAdInsertion';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding = await createEncoding(exampleName, 'Encoding with SSAI conditioned HLS streams');

  const input = await createHttpInput(configProvider.getHttpInputHost());
  const inputFilePath = configProvider.getHttpInputFilePath();

  const output = await createS3Output(
      configProvider.getS3OutputBucketName(),
      configProvider.getS3OutputAccessKey(),
      configProvider.getS3OutputSecretKey()
  );

  const videoConfigurations = [
    await createH264VideoConfig(1080, 4800000),
    await createH264VideoConfig(720, 2400000),
    await createH264VideoConfig(480, 1200000),
    await createH264VideoConfig(360, 800000),
    await createH264VideoConfig(240, 400000)
  ];

  // create a stream and fMP4 muxing for each video codec configuration
  const videoMuxings = new Map<VideoConfiguration, Fmp4Muxing>();
  for (let videoConfig of videoConfigurations) {
    const videoStream = await createStream(encoding, input, inputFilePath, videoConfig);
    const muxing = await createFmp4Muxing(encoding, output, `video/${videoConfig.height}`, videoStream);
    videoMuxings.set(videoConfig, muxing);
  }

  // create a stream and fMP4 muxing for audio
  const aacConfig = await createAacAudioConfig();
  const audioStream = await createStream(encoding, input, inputFilePath, aacConfig);
  const audioMuxing = await createFmp4Muxing(encoding, output, 'audio', audioStream);

  // define keyframes that are used to insert advertisement tags into the manifest
  const keyframes = await Promise.all(createKeyframes(encoding, [5, 15]));

  // create the master manifest that references audio and video playlists
  const manifest = await createHlsMasterManifest(output, '/');

  // create an audio playlist and provide it with custom tags for ad-placement
  const audioMediaInfo = await createAudioMediaPlaylist(encoding, manifest, audioMuxing, 'audio/');
  await placeAudioAdvertisementTags(manifest, audioMediaInfo, keyframes);

  // create a video playlist for each video muxing and provide it with custom tags for ad-placement
  for (const key of Array.from(videoMuxings.keys())) {
    const streamInfo = await createVideoStreamPlaylist(
        encoding,
        manifest,
        `video_${key.height}.m3u8`,
        videoMuxings.get(key)!,
        `video/${key.height}`,
        audioMediaInfo
    );
    await placeVideoAdvertisementTags(manifest, streamInfo, keyframes);
  }
  const startEncodingRequest = new StartEncodingRequest({
    manifestGenerator: ManifestGenerator.V2,
    vodHlsManifests: [buildManifestResource(manifest)]
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
    inputPath: inputPath
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
    streams: [new MuxingStream({streamId: stream.id})]
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
 * Creates keyframes at specified positions of the encoded output. With segmentCut set to true,
 * the written segments will be split at keyframe positions.
 *
 * @param encoding The encoding to which keyframes should be added
 * @param breakPlacements The points in time where keyframes should be inserted (specified in
 *     seconds)
 * @return The list of created keyframes
 */
function createKeyframes(encoding: Encoding, breakPlacements: number[]): Promise<Keyframe>[] {
  return breakPlacements.map(adBreak => {
    const keyframe = new Keyframe({
      time: adBreak,
      segmentCut: true
    });

    return bitmovinApi.encoding.encodings.keyframes.create(encoding.id!, keyframe);
  });
}

/**
 * Creates an HLS master manifest
 *
 * @param output The output resource to which the manifest will be written to
 * @param outputPath The path where the manifest will be written to
 */
function createHlsMasterManifest(output: Output, outputPath: string): Promise<HlsManifest> {
  const manifest = new HlsManifest({
    name: 'master.m3u8',
    manifestName: 'master.m3u8',
    outputs: [buildEncodingOutput(output, outputPath)]
  });

  return bitmovinApi.encoding.manifests.hls.create(manifest);
}

/**
 * Creates an HLS audio media playlist
 *
 * @param encoding The encoding to which the manifest belongs to
 * @param manifest The manifest to which the playlist should be added
 * @param audioMuxing The audio muxing for which the playlist should be generated
 * @param segmentPath The path containing the audio segments to be referenced by the playlist
 */
function createAudioMediaPlaylist(
    encoding: Encoding,
    manifest: HlsManifest,
    audioMuxing: Fmp4Muxing,
    segmentPath: string
): Promise<AudioMediaInfo> {
  const audioMediaInfo = new AudioMediaInfo({
    name: 'audio.m3u8',
    uri: 'audio.m3u8',
    groupId: 'audio',
    encodingId: encoding.id,
    streamId: audioMuxing.streams![0].streamId,
    muxingId: audioMuxing.id,
    language: 'en',
    assocLanguage: 'en',
    autoselect: false,
    isDefault: false,
    forced: false,
    segmentPath: segmentPath
  });

  return bitmovinApi.encoding.manifests.hls.media.audio.create(manifest.id!, audioMediaInfo);
}

/**
 * Creates an HLS video playlist
 *
 * @param encoding The encoding to which the manifest belongs to
 * @param manifest The manifest to which the playlist should be added
 * @param filename The filename to be used for the playlist file
 * @param muxing The video muxing for which the playlist should be generated
 * @param segmentPath The path containing the video segments to be referenced
 * @param audioMediaInfo The audio media playlist containing the associated audio group id
 */
function createVideoStreamPlaylist(
    encoding: Encoding,
    manifest: HlsManifest,
    filename: string,
    muxing: Fmp4Muxing,
    segmentPath: string,
    audioMediaInfo: AudioMediaInfo
): Promise<StreamInfo> {
  const streamInfo = new StreamInfo({
    uri: filename,
    encodingId: encoding.id,
    streamId: muxing.streams![0].streamId,
    muxingId: muxing.id,
    audio: audioMediaInfo.groupId,
    segmentPath: segmentPath
  });

  return bitmovinApi.encoding.manifests.hls.streams.create(manifest.id!, streamInfo);
}

/**
 * Adds custom tags for ad-placement to an HLS audio media playlist at given keyframe positions
 *
 * @param manifest The master manifest to which the playlist belongs to
 * @param audioMediaInfo The audio media playlist to which the tags should be added
 * @param keyframes A list of keyframes specifying the positions where tags will be inserted
 */
function placeAudioAdvertisementTags(
    manifest: HlsManifest,
    audioMediaInfo: AudioMediaInfo,
    keyframes: Keyframe[]
): Promise<CustomTag[]> {
  return Promise.all(
      keyframes.map(keyframe => {
        const customTag = new CustomTag({
          keyframeId: keyframe.id,
          positionMode: PositionMode.KEYFRAME,
          data: '#AD-PLACEMENT-OPPORTUNITY'
        });

        return bitmovinApi.encoding.manifests.hls.media.customTags.create(manifest.id!, audioMediaInfo.id!, customTag);
      })
  );
}

/**
 * Adds custom tags for ad-placement to an HLS video stream playlist at given keyframe positions
 *
 * @param manifest The master manifest to which the playlist belongs to
 * @param streamInfo The video stream playlist to which the tags should be added
 * @param keyframes A list of keyframes specifying the positions where tags will be inserted
 */
function placeVideoAdvertisementTags(
    manifest: HlsManifest,
    streamInfo: StreamInfo,
    keyframes: Keyframe[]
): Promise<CustomTag[]> {
  return Promise.all(
      keyframes.map(keyframe => {
        const customTag = new CustomTag({
          keyframeId: keyframe.id,
          positionMode: PositionMode.KEYFRAME,
          data: '#AD-PLACEMENT-OPPORTUNITY'
        });

        return bitmovinApi.encoding.manifests.hls.streams.customTags.create(manifest.id!, streamInfo.id!, customTag);
      })
  );
}

/**
 * Creates a configuration for the H.264 video codec to be applied to video streams.
 *
 * <p>The output resolution is defined by setting only the height. Width will be determined
 * automatically to maintain the aspect ratio of your input video.
 *
 * <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
 * proven settings for the codec. See <a
 * href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
 * to optimize your H264 codec configuration for different use-cases</a> for alternative presets.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
 *
 * @param height The height of the output video
 * @param bitrate The target bitrate of the output video
 */
function createH264VideoConfig(height: number, bitrate: number): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: `H.264 ${height}p`,
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: height,
    bitrate: bitrate
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
