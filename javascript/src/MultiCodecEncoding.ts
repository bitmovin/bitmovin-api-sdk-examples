import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AudioAdaptationSet,
  AudioMediaInfo,
  CmafMuxing,
  CodecConfiguration,
  ConsoleLogger,
  DashCmafRepresentation,
  DashFmp4Representation,
  DashManifest,
  DashProfile,
  DashRepresentationType,
  DashWebmRepresentation,
  DolbyDigitalAudioConfiguration,
  DolbyDigitalChannelLayout,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  H265VideoConfiguration,
  HlsManifest,
  HttpInput,
  Input,
  MessageType,
  Muxing,
  MuxingStream,
  Output,
  Period,
  PresetConfiguration,
  S3Output,
  Status,
  Stream,
  StreamInfo,
  StreamInput,
  StreamSelectionMode,
  Task,
  TsMuxing,
  VideoAdaptationSet,
  VorbisAudioConfiguration,
  Vp9VideoConfiguration,
  WebmMuxing
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how to use different codecs and muxing types in a single encoding.
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

const exampleName = `MultiCodecEncoding`;
const DATE_STRING = new Date().toISOString();
const HLS_AUDIO_GROUP_AAC_FMP4 = 'audio-aac-fmp4';
const HLS_AUDIO_GROUP_AAC_TS = 'audio-aac-ts';
const HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4 = 'audio-dolby-digital-fmp4';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger()
});

class Rendition {
  height: number;
  bitrate: number;

  constructor(height: number, bitrate: number) {
    this.height = height;
    this.bitrate = bitrate;
  }
}

class H264AndAacEncodingTracking {
  public encoding: Encoding;

  renditions: Array<Rendition> = [
    new Rendition(234, 145000),
    new Rendition(360, 365000),
    new Rendition(432, 730000),
    new Rendition(540, 2000000),
    new Rendition(720, 3000000)
  ];

  h264VideoStreams: Map<Rendition, Stream> = new Map<Rendition, Stream>();
  h264TsMuxings: Map<Rendition, TsMuxing> = new Map<Rendition, TsMuxing>();
  h264CmafMuxings: Map<Rendition, CmafMuxing> = new Map<Rendition, CmafMuxing>();

  aacAudioStream: Stream;
  aacFmp4Muxing: Fmp4Muxing;
  aacTsMuxing: TsMuxing;

  readonly H264_TS_SEGMENTS_PATH = 'video/h264/ts';
  readonly H264_CMAF_SEGMENTS_PATH = 'video/h264/cmaf';
  readonly AAC_FMP4_SEGMENTS_PATH = 'audio/aac/fmp4';
  readonly AAC_TS_SEGMENTS_PATH = 'audio/aac/ts';

  constructor(encoding: Encoding) {
    this.encoding = encoding;
  }
}

class H265AndDolbyDigitalEncodingTracking {
  encoding: Encoding;

  renditions: Array<Rendition> = [
    new Rendition(540, 600000),
    new Rendition(720, 2400000),
    new Rendition(1080, 4500000),
    new Rendition(2160, 11600000)
  ];

  h265VideoStreams: Map<Rendition, Stream> = new Map<Rendition, Stream>();
  h265Fmp4Muxings: Map<Rendition, Fmp4Muxing> = new Map<Rendition, Fmp4Muxing>();

  dolbyDigitalAudioStream: Stream;
  dolbyDigitalFmp4Muxing: Fmp4Muxing;

  readonly H265_FMP4_SEGMENTS_PATH = 'video/h265/fmp4';
  readonly DOLBY_DIGITAL_FMP4_SEGMENTS_PATH = 'audio/dolby-digital/fmp4';

  constructor(encoding: Encoding) {
    this.encoding = encoding;
  }
}

class Vp9AndVorbisEncodingTracking {
  encoding: Encoding;

  renditions: Array<Rendition> = [
    new Rendition(540, 600000),
    new Rendition(720, 2400000),
    new Rendition(1080, 4500000),
    new Rendition(2160, 11600000)
  ];

  vp9WebmMuxings: Map<Rendition, WebmMuxing> = new Map<Rendition, WebmMuxing>();
  vorbisWebmMuxing: WebmMuxing;

  readonly VP9_WEBM_SEGMENTS_PATH = 'video/vp9/webm';
  readonly VORBIS_WEBM_SEGMENTS_PATH = 'audio/vorbis/webm';

  constructor(encoding: Encoding) {
    this.encoding = encoding;
  }
}

async function main() {
  const input = await createHttpInput(configProvider.getHttpInputHost());
  const inputPath = configProvider.getHttpInputFilePath();

  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const h264AndAacEncodingTracking = await createH264AndAacEncoding(input, inputPath, output);
  const h265AndDolbyDigitalEncodingTracking = await createH265AndDolbyDigitalEncoding(input, inputPath, output);
  const vp9AndVorbisEncodingTracking = await createVp9AndVorbisEncoding(input, inputPath, output);

  await Promise.all([
    executeEncoding(h264AndAacEncodingTracking.encoding),
    executeEncoding(h265AndDolbyDigitalEncodingTracking.encoding),
    executeEncoding(vp9AndVorbisEncodingTracking.encoding)
  ]);

  const dashManifest = await createDashManifestWithRepresentations(
    output,
    h264AndAacEncodingTracking,
    h265AndDolbyDigitalEncodingTracking,
    vp9AndVorbisEncodingTracking
  );

  await executeDashManifest(dashManifest);

  const hlsManifest = await createHlsManifestWithRepresentations(
    output,
    h264AndAacEncodingTracking,
    h265AndDolbyDigitalEncodingTracking
  );

  await executeHlsManifest(hlsManifest);
}

/**
 * Creates the encoding with H264 codec/TS muxing, H264 codec/CMAF muxing, AAC codec/fMP4 muxing
 *
 * @param input the input that should be used
 * @param inputPath the path to the input file
 * @param output the output that should be used
 * @return the tracking information for the encoding
 */
async function createH264AndAacEncoding(
  input: Input,
  inputPath: string,
  output: Output
): Promise<H264AndAacEncodingTracking> {
  const encoding = await createEncoding(
    'H.264 Encoding',
    'H.264 -> TS muxing, H.264 -> CMAF muxing, AAC -> fMP4 muxing, AAC -> TS muxing'
  );

  const encodingTracking = new H264AndAacEncodingTracking(encoding);

  for (const rendition of encodingTracking.renditions) {
    const videoConfiguration = await createH264VideoConfig(rendition.height, rendition.bitrate);

    const videoStream = await createStream(encoding, input, inputPath, videoConfiguration);

    const cmafMuxing = await createCmafMuxing(
      encoding,
      output,
      `${encodingTracking.H264_CMAF_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoStream
    );
    const tsMuxing = await createTsMuxing(
      encoding,
      output,
      `${encodingTracking.H264_TS_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoStream
    );

    encodingTracking.h264VideoStreams.set(rendition, videoStream);
    encodingTracking.h264CmafMuxings.set(rendition, cmafMuxing);
    encodingTracking.h264TsMuxings.set(rendition, tsMuxing);
  }

  const aacConfig = await createAacAudioConfig();
  const aacAudioStream = await createStream(encoding, input, inputPath, aacConfig);

  encodingTracking.aacAudioStream = aacAudioStream;

  encodingTracking.aacFmp4Muxing = await createFmp4Muxing(
    encoding,
    output,
    encodingTracking.AAC_FMP4_SEGMENTS_PATH,
    aacAudioStream
  );

  encodingTracking.aacTsMuxing = await createTsMuxing(
    encoding,
    output,
    encodingTracking.AAC_TS_SEGMENTS_PATH,
    aacAudioStream
  );

  return encodingTracking;
}

/**
 * Creates the encoding with H265 codec/fMP4 muxing, Dolby Digital codec/fMP4 muxing
 *
 * @param input the input that should be used
 * @param inputPath the path to the input file
 * @param output the output that should be used
 * @return the tracking information for the encoding
 */
async function createH265AndDolbyDigitalEncoding(
  input: Input,
  inputPath: string,
  output: Output
): Promise<H265AndDolbyDigitalEncodingTracking> {
  const encoding = await createEncoding('H.265 Encoding', 'H.265 -> fMP4 muxing, Dolby Digital -> fMP4 muxing');

  const encodingTracking = new H265AndDolbyDigitalEncodingTracking(encoding);

  for (const rendition of encodingTracking.renditions) {
    const videoConfiguration = await createH265VideoConfig(rendition.height, rendition.bitrate);

    const videoStream = await createStream(encoding, input, inputPath, videoConfiguration);

    const fmp4Muxing = await createFmp4Muxing(
      encoding,
      output,
      `${encodingTracking.H265_FMP4_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoStream
    );

    encodingTracking.h265VideoStreams.set(rendition, videoStream);
    encodingTracking.h265Fmp4Muxings.set(rendition, fmp4Muxing);
  }

  const dolbyDigitalConfig = await createDolbyDigitalAudioConfig();
  const dolbyDigitalAudioStream = await createStream(encoding, input, inputPath, dolbyDigitalConfig);

  encodingTracking.dolbyDigitalAudioStream = dolbyDigitalAudioStream;

  encodingTracking.dolbyDigitalFmp4Muxing = await createFmp4Muxing(
    encoding,
    output,
    encodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
    dolbyDigitalAudioStream
  );

  return encodingTracking;
}

/**
 * Created the encoding with VP9 codec/WebM muxing, Vorbis codec / WebM muxing
 *
 * @param input the input that should be used
 * @param inputPath the path to the input file
 * @param output the output that should be used
 * @return the tracking information for the encoding
 */
async function createVp9AndVorbisEncoding(
  input: Input,
  inputPath: string,
  output: Output
): Promise<Vp9AndVorbisEncodingTracking> {
  const encoding = await createEncoding('VP9/Vorbis Encoding', 'VP9 -> WebM muxing, Vorbis -> WebM muxing');

  const encodingTracking = new Vp9AndVorbisEncodingTracking(encoding);

  for (const rendition of encodingTracking.renditions) {
    const videoConfiguration = await createVp9VideoConfiguration(rendition.height, rendition.bitrate);

    const videoStream = await createStream(encoding, input, inputPath, videoConfiguration);

    const fmp4Muxing = await createWebmMuxing(
      encoding,
      output,
      `${encodingTracking.VP9_WEBM_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoStream
    );

    encodingTracking.vp9WebmMuxings.set(rendition, fmp4Muxing);
  }

  const vorbisAudioConfig = await createVorbisAudioConfiguration();
  const vorbisAudioStream = await createStream(encoding, input, inputPath, vorbisAudioConfig);

  encodingTracking.vorbisWebmMuxing = await createWebmMuxing(
    encoding,
    output,
    encodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
    vorbisAudioStream
  );

  return encodingTracking;
}

/**
 * Creates the DASH manifest with all the representations.
 *
 * @param output the output that should be used
 * @param h264AndAacEncodingTracking the tracking information for the H264/AAC encoding
 * @param h265AndDolbyDigitalEncodingTracking the tracking information for the H265 encoding
 * @param vp9AndVorbisEncodingTracking the tracking information for the VP9/Vorbis encoding
 * @return the created DASH manifest
 */
async function createDashManifestWithRepresentations(
  output: Output,
  h264AndAacEncodingTracking: H264AndAacEncodingTracking,
  h265AndDolbyDigitalEncodingTracking: H265AndDolbyDigitalEncodingTracking,
  vp9AndVorbisEncodingTracking: Vp9AndVorbisEncodingTracking
): Promise<DashManifest> {
  const dashManifest = await createDashManifest('stream.mpd', DashProfile.LIVE, output, '/');

  const period = await bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.id!, new Period());

  const videoAdaptationSetVp9 = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );
  const videoAdaptationSetH265 = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );
  const videoAdaptationSetH264 = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );

  const vorbisAudioAdaptationSet = await createAudioAdaptionSet(dashManifest, period, 'en');
  const dolbyDigitalAudioAdaptationSet = await createAudioAdaptionSet(dashManifest, period, 'en');
  const aacAudioAdaptationSet = await createAudioAdaptionSet(dashManifest, period, 'en');

  for (const [rendition, vp9WebmMuxing] of vp9AndVorbisEncodingTracking.vp9WebmMuxings) {
    await createDashWebmRepresentation(
      vp9AndVorbisEncodingTracking.encoding,
      vp9WebmMuxing,
      dashManifest,
      period,
      `${vp9AndVorbisEncodingTracking.VP9_WEBM_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoAdaptationSetVp9.id!
    );
  }

  // Add VORBIS WEBM muxing to VORBIS audio adaptation set
  await createDashWebmRepresentation(
    vp9AndVorbisEncodingTracking.encoding,
    vp9AndVorbisEncodingTracking.vorbisWebmMuxing,
    dashManifest,
    period,
    vp9AndVorbisEncodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
    vorbisAudioAdaptationSet.id!
  );

  // Add representations to H265 adaptation set
  // Add H265 FMP4 muxing to H265 video adaptation set
  for (const [rendition, h265Fmp4Muxing] of h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings) {
    await createDashFmp4Representation(
      h265AndDolbyDigitalEncodingTracking.encoding,
      h265Fmp4Muxing,
      dashManifest,
      period,
      `${h265AndDolbyDigitalEncodingTracking.H265_FMP4_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoAdaptationSetH265.id!
    );
  }

  // Add Dolby Digital FMP4 muxing to Dolby Digital audio adaptation set
  await createDashFmp4Representation(
    h265AndDolbyDigitalEncodingTracking.encoding,
    h265AndDolbyDigitalEncodingTracking.dolbyDigitalFmp4Muxing,
    dashManifest,
    period,
    h265AndDolbyDigitalEncodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
    dolbyDigitalAudioAdaptationSet.id!
  );

  // Add representations to H264 adaptation set
  // Add H264 CMAF muxing to H264 video adaptation set
  for (const [rendition, h264CmafMuxing] of h264AndAacEncodingTracking.h264CmafMuxings) {
    await createDashCmafRepresentation(
      h264AndAacEncodingTracking.encoding,
      h264CmafMuxing,
      dashManifest,
      period,
      `${h264AndAacEncodingTracking.H264_CMAF_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      videoAdaptationSetH264.id!
    );
  }

  // Add AAC FMP4 muxing to AAC audio adaptation set
  await createDashFmp4Representation(
    h264AndAacEncodingTracking.encoding,
    h264AndAacEncodingTracking.aacFmp4Muxing,
    dashManifest,
    period,
    h264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
    aacAudioAdaptationSet.id!
  );

  return dashManifest;
}

async function createHlsManifestWithRepresentations(
  output: Output,
  h264AndAacEncodingTracking: H264AndAacEncodingTracking,
  h265AndDolbyDigitalEncodingTracking: H265AndDolbyDigitalEncodingTracking
): Promise<HlsManifest> {
  const hlsManifest = await createHlsMasterManifest('master.m3u8', output, '/');

  // Create h265 audio playlists
  await createAudioMediaPlaylist(
    h265AndDolbyDigitalEncodingTracking.encoding,
    hlsManifest,
    h265AndDolbyDigitalEncodingTracking.dolbyDigitalFmp4Muxing,
    h265AndDolbyDigitalEncodingTracking.dolbyDigitalAudioStream,
    'audio_dolby_digital_fmp4.m3u8',
    h265AndDolbyDigitalEncodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
    HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4
  );

  // Create h265 video playlists
  for (const [rendition, h265Fmp4Muxing] of h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings) {
    await createVideoStreamPlaylist(
      h265AndDolbyDigitalEncodingTracking.encoding,
      hlsManifest,
      h265Fmp4Muxing,
      h265AndDolbyDigitalEncodingTracking.h265VideoStreams.get(rendition)!,
      `video_h265_${rendition.height}p_${rendition.bitrate}.m3u8`,
      `${h265AndDolbyDigitalEncodingTracking.H265_FMP4_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4
    );
  }

  // Create h264 audio playlists
  await createAudioMediaPlaylist(
    h264AndAacEncodingTracking.encoding,
    hlsManifest,
    h264AndAacEncodingTracking.aacFmp4Muxing,
    h264AndAacEncodingTracking.aacAudioStream,
    'audio_aac_fmp4.m3u8',
    h264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
    HLS_AUDIO_GROUP_AAC_FMP4
  );

  await createAudioMediaPlaylist(
    h264AndAacEncodingTracking.encoding,
    hlsManifest,
    h264AndAacEncodingTracking.aacTsMuxing,
    h264AndAacEncodingTracking.aacAudioStream,
    'audio_aac_ts.m3u8',
    h264AndAacEncodingTracking.AAC_TS_SEGMENTS_PATH,
    HLS_AUDIO_GROUP_AAC_TS
  );

  // Create h264 video playlists
  for (const [rendition, h264TsMuxing] of h264AndAacEncodingTracking.h264TsMuxings) {
    await createVideoStreamPlaylist(
      h264AndAacEncodingTracking.encoding,
      hlsManifest,
      h264TsMuxing,
      h264AndAacEncodingTracking.h264VideoStreams.get(rendition)!,
      `video_h264_${rendition.height}p_${rendition.bitrate}.m3u8`,
      `${h264AndAacEncodingTracking.H264_TS_SEGMENTS_PATH}/${rendition.height}p_${rendition.bitrate}`,
      HLS_AUDIO_GROUP_AAC_TS
    );
  }

  return hlsManifest;
}

/** Creates the HLS master manifest. */
async function createHlsMasterManifest(name: string, output: Output, outputPath: string): Promise<HlsManifest> {
  const hlsManifest = new HlsManifest({
    name: name,
    outputs: [buildEncodingOutput(output, outputPath)]
  });

  return bitmovinApi.encoding.manifests.hls.create(hlsManifest);
}

/**
 * Creates an HLS audio media playlist.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaAudioByManifestId
 *
 * @param encoding the encoding where the resources belong to
 * @param manifest the manifest where the audio playlist should be added
 * @param audioMuxing the audio muxing that should be used
 * @param audioStream the audio stream of the muxing
 * @param audioSegmentsPath the path to the audio segments
 */
async function createAudioMediaPlaylist(
  encoding: Encoding,
  manifest: HlsManifest,
  audioMuxing: Muxing,
  audioStream: Stream,
  uri: string,
  audioSegmentsPath: string,
  audioGroup: string
) {
  const audioMediaInfo = new AudioMediaInfo({
    name: uri,
    uri: uri,
    groupId: audioGroup,
    encodingId: encoding.id,
    streamId: audioStream.id,
    muxingId: audioMuxing.id,
    language: 'en',
    assocLanguage: 'en',
    autoselect: false,
    isDefault: false,
    forced: false,
    segmentPath: audioSegmentsPath
  });

  await bitmovinApi.encoding.manifests.hls.media.audio.create(manifest.id!, audioMediaInfo);
}

/**
 * Creates an HLS video playlist
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
 *
 * @param encoding the encoding where the resources belong to
 * @param manifest the master manifest where the video stream playlist should belong to
 * @param videoMuxing the muxing that should be used
 * @param videoStream the stream of the muxing
 * @param uri the relative uri of the playlist file that will be generated
 * @param segmentPath the path pointing to the respective video segments
 */
async function createVideoStreamPlaylist(
  encoding: Encoding,
  manifest: HlsManifest,
  videoMuxing: Muxing,
  videoStream: Stream,
  uri: string,
  segmentPath: string,
  audioGroup: string
) {
  const streamInfo = new StreamInfo({
    uri: uri,
    encodingId: encoding.id,
    streamId: videoStream.id,
    muxingId: videoMuxing.id,
    audio: audioGroup,
    segmentPath: segmentPath
  });

  await bitmovinApi.encoding.manifests.hls.streams.create(manifest.id!, streamInfo);
}

/**
 * Creates a DASH WEBM representation
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsWebmByManifestIdAndPeriodIdAndAdaptationsetId
 *
 * @param encoding the encoding where the resources belong to
 * @param muxing the muxing that should be used for this representation
 * @param dashManifest the dash manifest to which the representation should be added
 * @param period the period to which the represenation should be added
 * @param segmentPath the path to the WEBM segments
 * @param adaptationSetId the adaptationset to which the representation should be added
 */
async function createDashWebmRepresentation(
  encoding: Encoding,
  muxing: WebmMuxing,
  dashManifest: DashManifest,
  period: Period,
  segmentPath: string,
  adaptationSetId: string
) {
  const dashWebmRepresentation = new DashWebmRepresentation({
    type: DashRepresentationType.TEMPLATE,
    encodingId: encoding.id,
    muxingId: muxing.id,
    segmentPath: segmentPath
  });

  await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.webm.create(
    dashManifest.id!,
    period.id!,
    adaptationSetId,
    dashWebmRepresentation
  );
}

/**
 * Creates a DASH fMP4 representation.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param encoding the encoding where the resources belong to
 * @param muxing the muxing that should be used for this representation
 * @param dashManifest the dash manifest to which the representation should be added
 * @param period the period to which the represenation should be added
 * @param segmentPath the path to the WEBM segments
 * @param adaptationSetId the adaptationset to which the representation should be added
 */
async function createDashFmp4Representation(
  encoding: Encoding,
  muxing: Fmp4Muxing,
  dashManifest: DashManifest,
  period: Period,
  segmentPath: string,
  adaptationSetId: string
) {
  const dashFmp4Representation = new DashFmp4Representation({
    type: DashRepresentationType.TEMPLATE,
    encodingId: encoding.id,
    muxingId: muxing.id,
    segmentPath: segmentPath
  });

  await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
    dashManifest.id!,
    period.id!,
    adaptationSetId,
    dashFmp4Representation
  );
}

/**
 * Creates a DASH CMAF representation
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsCmafByManifestIdAndPeriodIdAndAdaptationsetId
 *
 * @param encoding the encoding where the resources belong to
 * @param muxing the muxing that should be used for this representation
 * @param dashManifest the dash manifest to which the representation should be added
 * @param period the period to which the representation should be added
 * @param segmentPath the path the the CMAF segments
 * @param adaptationSetId the adaptation set to which the representation should be added
 */
async function createDashCmafRepresentation(
  encoding: Encoding,
  muxing: CmafMuxing,
  dashManifest: DashManifest,
  period: Period,
  segmentPath: string,
  adaptationSetId: string
) {
  const dashCmafRepresentation = new DashCmafRepresentation({
    type: DashRepresentationType.TEMPLATE,
    encodingId: encoding.id,
    muxingId: muxing.id,
    segmentPath: segmentPath
  });

  await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.cmaf.create(
    dashManifest.id!,
    period.id!,
    adaptationSetId,
    dashCmafRepresentation
  );
}

/**
 * Creates a DASH manifest
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param name the resource name
 * @param dashProfile the DASH profile of the manifest (ON_DEMAND, LIVE)
 * @param output the output of the manifest
 * @param outputPath the output path where the manifest is written to
 * @return the created manifest
 */
async function createDashManifest(
  name: string,
  dashProfile: DashProfile,
  output: Output,
  outputPath: string
): Promise<DashManifest> {
  const dashManifest = new DashManifest({
    name: name,
    profile: dashProfile,
    outputs: [buildEncodingOutput(output, outputPath)]
  });

  return bitmovinApi.encoding.manifests.dash.create(dashManifest);
}

/** Creates an audio adaption set for the dash manifest */
async function createAudioAdaptionSet(
  dashManifest: DashManifest,
  period: Period,
  language: string
): Promise<AudioAdaptationSet> {
  const audioAdaptationSet = new AudioAdaptationSet({
    lang: language
  });

  return bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
    dashManifest.id!,
    period.id!,
    audioAdaptationSet
  );
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
    selectionMode: StreamSelectionMode.AUTO,
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
 * Creates a progressive TS muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsTsByEncodingId
 *
 * @param encoding The encoding to add the muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragments will be written to
 * @param stream A list of streams to be added to the muxing
 */
function createTsMuxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<TsMuxing> {
  const muxing = new TsMuxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [new MuxingStream({streamId: stream.id})],
    segmentLength: 4.0
  });

  return bitmovinApi.encoding.encodings.muxings.ts.create(encoding.id!, muxing);
}

/**
 * Creates a CMAF muxing. This will generate segments with a given segment length for adaptive
 * streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsCmafByEncodingId
 *
 * @param encoding The encoding to add the muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragmented segments will be written to
 * @param stream The stream that is associated with the muxing
 */
function createCmafMuxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<CmafMuxing> {
  const muxing = new CmafMuxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [new MuxingStream({streamId: stream.id})],
    segmentLength: 4.0
  });

  return bitmovinApi.encoding.encodings.muxings.cmaf.create(encoding.id!, muxing);
}

/**
 * Creates a CMAF muxing. This will generate segments with a given segment length for adaptive
 * streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsCmafByEncodingId
 *
 * @param encoding The encoding to add the muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragmented segments will be written to
 * @param stream The stream that is associated with the muxing
 */
function createWebmMuxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<WebmMuxing> {
  const muxing = new WebmMuxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [new MuxingStream({streamId: stream.id})],
    segmentLength: 4.0
  });

  return bitmovinApi.encoding.encodings.muxings.webm.create(encoding.id!, muxing);
}

/**
 * Creates an MP4 muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId
 *
 * @param encoding The encoding to add the MP4 muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragments will be written to
 * @param stream A list of streams to be added to the muxing
 */
function createFmp4Muxing(encoding: Encoding, output: Output, outputPath: string, stream: Stream): Promise<Fmp4Muxing> {
  const muxing = new Fmp4Muxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [new MuxingStream({streamId: stream.id})],
    segmentLength: 4.0
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
  return join(configProvider.getS3OutputBasePath(), `${exampleName}-${DATE_STRING}`, relativePath);
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
 * Creates a basic H.265 video configuration. The width of the video will be set accordingly to the
 * aspect ratio of the source video.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
 */
function createH265VideoConfig(height: number, bitrate: number): Promise<H265VideoConfiguration> {
  const config = new H265VideoConfiguration({
    name: 'H.265 ${height}p',
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: height,
    bitrate: bitrate
  });

  return bitmovinApi.encoding.configurations.video.h265.create(config);
}

/**
 * Creates a base VP9 video configuration. The width of the video will be set accordingly to the
 * aspect ratio of the source video.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoVp9
 */
function createVp9VideoConfiguration(height: number, bitrate: number): Promise<Vp9VideoConfiguration> {
  const config = new Vp9VideoConfiguration({
    name: 'VP9 video configuration ${height}p',
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: height,
    bitrate: bitrate
  });

  return bitmovinApi.encoding.configurations.video.vp9.create(config);
}

/**
 * Creates a Vorbis audio configuration. The sample rate of the audio will be set accordingly to
 * the sample rate of the source audio.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioVorbis
 */
function createVorbisAudioConfiguration(): Promise<VorbisAudioConfiguration> {
  const config = new VorbisAudioConfiguration({
    name: 'Vorbis 128 kbit/s',
    bitrate: 128000
  });

  return bitmovinApi.encoding.configurations.audio.vorbis.create(config);
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
 * Creates a Dolby Digital audio configuration. The sample rate of the audio will be set accordingly to the
 * sample rate of the source audio.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioDD
 */
function createDolbyDigitalAudioConfig(): Promise<DolbyDigitalAudioConfiguration> {
  const config = new DolbyDigitalAudioConfiguration({
    name: 'Dolby Digital Channel Layout 5.1',
    bitrate: 256000,
    channelLayout: DolbyDigitalChannelLayout.CL_5_1
  });

  return bitmovinApi.encoding.configurations.audio.dolbyDigital.create(config);
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
 */
async function executeEncoding(encoding: Encoding): Promise<void> {
  await bitmovinApi.encoding.encodings.start(encoding.id!);

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
 * Starts the dash manifest generation process and periodically polls its status until it reaches
 * a final state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId
 *
 * <p>Please note that you can also use our webhooks API instead of polling the status. For more
 * information consult the API spec:
 * https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
 *
 * @param dashManifest The dash manifest to be started
 */
async function executeDashManifest(dashManifest: DashManifest): Promise<void> {
  await bitmovinApi.encoding.manifests.dash.start(dashManifest.id!);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.manifests.dash.status(dashManifest.id!);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('Dash manifest failed');
  }

  console.log('Dash manifest finished successfully');
}

/**
 * Starts the hls manifest generation process and periodically polls its status until it reaches a
 * final state
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
 *
 * <p>Please note that you can also use our webhooks API instead of polling the status. For more
 * information consult the API spec:
 * https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
 *
 * @param hlsManifest The dash manifest to be started
 */
async function executeHlsManifest(hlsManifest: HlsManifest): Promise<void> {
  await bitmovinApi.encoding.manifests.hls.start(hlsManifest.id!);

  let task: Task;
  do {
    await timeout(5000);
    task = await bitmovinApi.encoding.manifests.hls.status(hlsManifest.id!);
  } while (task.status !== Status.FINISHED && task.status !== Status.ERROR);

  if (task.status === Status.ERROR) {
    logTaskErrors(task);
    throw new Error('Hls manifest failed');
  }

  console.log('Hls manifest finished successfully');
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
