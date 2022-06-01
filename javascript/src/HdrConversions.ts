import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi from '@bitmovin/api-sdk';
import {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AudioAdaptationSet,
  AudioMediaInfo,
  CodecConfigType,
  CodecConfiguration,
  ConsoleLogger,
  DashFmp4Representation,
  DashManifest,
  DashRepresentationType,
  DolbyVisionInputStream,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H265DynamicRangeFormat,
  H265VideoConfiguration,
  HlsManifest,
  HlsVersion,
  HttpInput,
  IngestInputStream,
  Input,
  InputStream,
  MessageType,
  MuxingStream,
  Output,
  Period,
  PresetConfiguration,
  ProfileH265,
  S3Output,
  Status,
  Stream,
  StreamInfo,
  StreamInput,
  StreamSelectionMode,
  Task,
  VideoAdaptationSet,
} from '@bitmovin/api-sdk';
import {join} from 'path';

/**
 * This example demonstrates how to convert dynamic range format between DolbyVision, HDR10, HLG and SDR.
 * The supported HDR/SDR conversions are following. If targeting output format is either DolbyVision, HDR10 or HLG, this
 * example adds SDR renditions automatically. This example works only with Bitmovin Encoder version 2.98.0 or later.
 *   - Input: DolbyVision
 *     - Output:
 *       - DolbyVision and SDR
 *       - HDR10 and SDR
 *   - Input: HDR10
 *     - Output:
 *       - HDR10 and SDR
 *       - HLG and SDR
 *   - Input: HLG
 *     - Output:
 *       - HLG and SDR
 *       - HDR10 and SDR
 *   - Input: SDR
 *     - Output:
 *       - HDR10 and SDR
 *       - HLG and SDR
 *
 * <p>This example assumes that the audio is stored in a separate file from the video.
 * <p>The following configuration parameters are expected:
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file.
 *   <li>HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH - The path to your DolbyVision metadata file. This parameter is
 *       required only when using DolbyVision input file with a separated sidecar XML metadata file.
 *   <li>HTTP_INPUT_AUDIO_FILE_PATH - The path to your audio file in case you want to load audio stream from a separate
 *       input file. If HTTP_INPUT_FILE_PATH has audio track too, you can specify the same path in this parameter.
 *   <li>HDR_CONVERSION_INPUT_FORMAT - The input HDR format. Either DolbyVision, HDR10, HLG, or SDR can be specified.
 *       This parameter needs to be matched with the actual HDR format of the input file.
 *   <li>HDR_CONVERSION_OUTPUT_FORMAT - The output HDR format to be converted from input file.
 *       Either DolbyVision, HDR10, HLG, or SDR can be specified.
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
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
const inputFormat = configProvider.getHdrConversionInputFormat();
const outputFormat = configProvider.getHdrConversionOutputFormat();

const exampleName = `${inputFormat}To${outputFormat}`;
const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger(),
});

async function main() {
  const encoding: Encoding = await createEncoding(
    exampleName,
    `Encoding with HDR conversion from ${inputFormat} to ${outputFormat}`
  );

  const input = await createHttpInput(configProvider.getHttpInputHost());

  const videoInputPath = configProvider.getHttpInputFilePath();
  const audioInputPath = configProvider.getHttpAudioFilePath();

  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  let videoInputStream;
  if (inputFormat == 'DolbyVision') {
    let inputMetadataPath = configProvider.getHttpDolbyVisionMetadataFilePath();
    videoInputStream = await createDolbyVisionInputStream(encoding, input, videoInputPath, inputMetadataPath);
  } else {
    videoInputStream = await createIngestInputStream(encoding, input, videoInputPath);
  }

  let audioInputStream = await createIngestInputStream(encoding, input, audioInputPath);

  await createH265AndAacEncoding(encoding, videoInputStream, audioInputStream, output);

  await executeEncoding(encoding);

  const dashManifest = await createDashManifest(encoding, output, '/');
  await executeDashManifest(dashManifest);

  const hlsManifest = await createHlsManifest(encoding, output, '/');
  await executeHlsManifest(hlsManifest);
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
 * Creates an IngestInputStream and adds it to an encoding
 *
 * <p>The IngestInputStream is used to define where a file to read a stream from is located
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
 *
 * @param encoding The encoding to which the stream will be added
 * @param input The input resource providing the input file
 * @param inputPath The path to the input file
 */
function createIngestInputStream(encoding: Encoding, input: Input, inputPath: string): Promise<IngestInputStream> {
  const ingestInputStream = new IngestInputStream({
    inputId: input.id,
    inputPath: inputPath,
    selectionMode: StreamSelectionMode.AUTO,
  });

  return bitmovinApi.encoding.encodings.inputStreams.ingest.create(encoding.id!, ingestInputStream);
}

/**
 * Creates a DolbyVisionInputStream and adds it to an encoding.
 *
 * <p>API endpoints:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsDolbyVisionByEncodingId
 *
 * <p>The DolbyVisionInputStream is used to define where a file to read a dolby vision stream from is located.
 *
 * @param encoding The encoding to which the stream will be added
 * @param input The input resource providing the input file
 * @param dolbyVisionInputPath The path to the DolbyVision input file
 * @param dolbyVisionMetadataInputPath The path to the DolbyVision XML metadata file if a sidecar XML is used. For embedded metadata case, it should be None.
 */
function createDolbyVisionInputStream(
  encoding: Encoding,
  input: Input,
  dolbyVisionInputPath: string,
  dolbyVisionMetadataInputPath: string
): Promise<IngestInputStream> {
  const ingestInputStream = new DolbyVisionInputStream({
    inputId: input.id,
    videoInputPath: dolbyVisionInputPath,
    metadataInputPath: dolbyVisionMetadataInputPath,
  });

  return bitmovinApi.encoding.encodings.inputStreams.dolbyVision.create(encoding.id!, ingestInputStream);
}

/**
 * Creates an encoding with H265 codec/fMP4 muxing and AAC codec/fMP4 muxing
 *
 * @param encoding The encoding to be started
 * @param videoInputStream The video input to be used for the encoding
 * @param audioInputStream The audio input to be used for the encoding
 * @param output the output that should be used
 */
async function createH265AndAacEncoding(
  encoding: Encoding,
  videoInputStream: InputStream,
  audioInputStream: InputStream,
  output: Output
) {
  let renditions = createRenditions();

  for (const {height, bitrate, dynamicRangeFormat, profile} of renditions) {
    let streamName;
    let outputPath;

    if (isDynamicRangeFormatOfDolbyVisionOrHdrOrHlg(dynamicRangeFormat)) {
      outputPath = `video/hdr/${height}p_${bitrate / 1000}kbps/`;
      streamName = `H265 HDR stream ${height}p`;
    } else {
      outputPath = `video/sdr/${height}p_${bitrate / 1000}kbps/`;
      streamName = `H265 SDR stream ${height}p`;
    }

    let h265VideoConfiguration = await createH265VideoConfig(height, bitrate, profile, dynamicRangeFormat);
    let stream = await createStream(streamName, encoding, videoInputStream, h265VideoConfiguration);
    await createFmp4Muxing(encoding, output, outputPath, stream);
  }

  let aacConfig = await createAacAudioConfig();

  let aacAudioStream = await createStream(
    `AAC stream ${aacConfig.bitrate! / 1000}kbps`,
    encoding,
    audioInputStream,
    aacConfig
  );

  await createFmp4Muxing(encoding, output, `"audio/${aacConfig.bitrate! / 1000}kbps/`, aacAudioStream);
}

function createRenditions() {
  let profile: ProfileH265 = ProfileH265.MAIN10;
  let dynamicRangeFormat: H265DynamicRangeFormat;
  let needsSdrConversion = true;

  if (inputFormat == 'DolbyVision') {
    if (outputFormat == 'DolbyVision') {
      dynamicRangeFormat = H265DynamicRangeFormat.DOLBY_VISION;
    } else if (outputFormat == 'HDR10') {
      dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
    } else {
      throw new Error('Not supported');
    }
  } else if (inputFormat == 'HDR10') {
    if (outputFormat == 'HDR10') {
      dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
    } else if (outputFormat == 'HLG') {
      dynamicRangeFormat = H265DynamicRangeFormat.HLG;
    } else {
      throw new Error('Not supported');
    }
  } else if (inputFormat == 'HLG') {
    if (outputFormat == 'HDR10') {
      dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
    } else if (outputFormat == 'HLG') {
      dynamicRangeFormat = H265DynamicRangeFormat.HLG;
    } else {
      throw new Error('Not supported');
    }
  } else if (inputFormat == 'SDR') {
    if (outputFormat == 'HDR10') {
      dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
    } else if (outputFormat == 'HLG') {
      dynamicRangeFormat = H265DynamicRangeFormat.HLG;
    } else if (outputFormat == 'SDR') {
      profile = ProfileH265.MAIN;
      dynamicRangeFormat = H265DynamicRangeFormat.SDR;
      needsSdrConversion = false;
    } else {
      throw new Error(`The dynamic range format ${outputFormat} is not supported.`);
    }
  } else {
    throw new Error(`The input format ${inputFormat} is not supported.`);
  }

  let renditions = [
    {height: 360, bitrate: 160000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
    {height: 540, bitrate: 730000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
    {height: 720, bitrate: 2900000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
    {height: 1080, bitrate: 5400000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
    {height: 1440, bitrate: 9700000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
    {height: 2160, bitrate: 13900000, dynamicRangeFormat: dynamicRangeFormat, profile: profile},
  ];

  if (needsSdrConversion) {
    let sdrRenditions = [
      {height: 360, bitrate: 145000, dynamicRangeFormat: H265DynamicRangeFormat.SDR, profile: ProfileH265.MAIN},
      {height: 540, bitrate: 600000, dynamicRangeFormat: H265DynamicRangeFormat.SDR, profile: ProfileH265.MAIN},
      {height: 720, bitrate: 2400000, dynamicRangeFormat: H265DynamicRangeFormat.SDR, profile: ProfileH265.MAIN},
      {height: 1080, bitrate: 4500000, dynamicRangeFormat: H265DynamicRangeFormat.SDR, profile: ProfileH265.MAIN},
    ];
    renditions.push(...sdrRenditions);
  }
  return renditions;
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
 * @param height The height of the output video
 * @param bitrate The target bitrate of the output video
 * @param profile The target H.265 profile (MAIN or MAIN10) of the output video
 * @param dynamicRangeFormat The target dynamic range format of the output video
 */
function createH265VideoConfig(height, bitrate, profile, dynamicRangeFormat): Promise<H265VideoConfiguration> {
  const config = new H265VideoConfiguration({
    name: `H.265 ${height}p`,
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    profile: profile,
    height: height,
    bitrate: bitrate,
    bufsize: bitrate * 2,
    dynamicRangeFormat: dynamicRangeFormat,
  });

  return bitmovinApi.encoding.configurations.video.h265.create(config);
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
 * @param name The name of the stream
 * @param encoding The encoding to which the stream will be added
 * @param inputStream The input stream resource providing the input video or audio
 * @param codecConfiguration The codec configuration to be applied to the stream
 */
function createStream(
  name: string,
  encoding: Encoding,
  inputStream: InputStream,
  codecConfiguration: CodecConfiguration
) {
  console.log('inputStreamId', inputStream.id);

  const streamInput = new StreamInput({
    inputStreamId: inputStream.id,
  });

  const stream = new Stream({
    name: name,
    inputStreams: [streamInput],
    codecConfigId: codecConfiguration.id,
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
    streamId: stream.id,
  });

  const muxing = new Fmp4Muxing({
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [muxingStream],
    segmentLength: 4,
  });

  return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.id!, muxing);
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
    manifestName: 'stream.mpd',
    outputs: [buildEncodingOutput(output, outputPath)],
    name: 'DASH Manifest',
  });

  dashManifest = await bitmovinApi.encoding.manifests.dash.create(dashManifest);
  let period = await bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.id!, new Period());

  let videoAdaptationSetHdr = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );
  let videoAdaptationSetSdr = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
    dashManifest.id!,
    period.id!,
    new VideoAdaptationSet()
  );
  let audioAdaptationSet = await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
    dashManifest.id!,
    period.id!,
    new AudioAdaptationSet({lang: 'en'})
  );

  let muxings = await bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.id!);
  for (let muxing of muxings.items!) {
    let stream = await bitmovinApi.encoding.encodings.streams.get(encoding.id!, muxing.streams![0].streamId!);
    let segmentPath = removeOutputBasePath(muxing.outputs![0].outputPath!);
    let dashFmp4Representation = new DashFmp4Representation({
      type: DashRepresentationType.TEMPLATE,
      encodingId: encoding.id,
      muxingId: muxing.id,
      segmentPath: segmentPath,
    });

    let adaptationSet = videoAdaptationSetSdr.id!;
    let codec = await bitmovinApi.encoding.configurations.type.get(stream.codecConfigId!);
    if (codec.type == CodecConfigType.H265) {
      let codecInfo = await bitmovinApi.encoding.configurations.video.h265.get(stream.codecConfigId!);

      if (isDynamicRangeFormatOfDolbyVisionOrHdrOrHlg(codecInfo.dynamicRangeFormat)) {
        adaptationSet = videoAdaptationSetHdr.id!;
      }
    } else if (codec.type == CodecConfigType.AAC) {
      adaptationSet = audioAdaptationSet.id!;
    }

    await bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
      dashManifest.id!,
      period.id!,
      adaptationSet,
      dashFmp4Representation
    );
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
    manifestName: 'master.m3u8',
    outputs: [buildEncodingOutput(output, outputPath)],
    name: 'HLS Manifest',
    hlsMasterPlaylistVersion: HlsVersion.HLS_V8,
    hlsMediaPlaylistVersion: HlsVersion.HLS_V8,
  });

  hlsManifest = await bitmovinApi.encoding.manifests.hls.create(hlsManifest);

  let muxings = await bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.id!);
  for (let muxing of muxings.items!) {
    let stream = await bitmovinApi.encoding.encodings.streams.get(encoding.id!, muxing.streams![0].streamId!);
    let segmentPath = removeOutputBasePath(muxing.outputs![0].outputPath!);
    let codec = await bitmovinApi.encoding.configurations.type.get(stream.codecConfigId!);
    if (codec.type == CodecConfigType.H265) {
      let codecInfo = await bitmovinApi.encoding.configurations.video.h265.get(stream.codecConfigId!);

      let url = `stream_sdr_${codecInfo.bitrate}.m3u8`;
      if (isDynamicRangeFormatOfDolbyVisionOrHdrOrHlg(codecInfo.dynamicRangeFormat!)) {
        url = `stream_hdr_${codecInfo.bitrate}.m3u8`;
      }

      let streamInfo = new StreamInfo({
        audio: 'AUDIO',
        closedCaptions: 'NONE',
        segmentPath: '',
        uri: segmentPath + url,
        encodingId: encoding.id,
        streamId: stream.id,
        muxingId: muxing.id,
        forceVideoRangeAttribute: true,
        forceFrameRateAttribute: true,
      });
      await bitmovinApi.encoding.manifests.hls.streams.create(hlsManifest.id!, streamInfo);
    } else if (codec.type == CodecConfigType.AAC) {
      let codecInfo = await bitmovinApi.encoding.configurations.audio.aac.get(stream.codecConfigId!);
      let url = `aac_${codecInfo.bitrate}.m3u8`;
      let audioMediaInfo = new AudioMediaInfo({
        name: 'HLS Audio Media',
        groupId: 'AUDIO',
        segmentPath: '',
        encodingId: encoding.id,
        streamId: stream.id,
        muxingId: muxing.id,
        language: 'en',
        uri: segmentPath + url,
      });
      await bitmovinApi.encoding.manifests.hls.media.audio.create(hlsManifest.id!, audioMediaInfo);
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
function removeOutputBasePath(absolutePath: string) {
  const startPath = configProvider.getS3OutputBasePath() + exampleName;
  if (absolutePath.startsWith(startPath)) {
    return absolutePath.substr(startPath.length + 1);
  }

  return absolutePath;
}

function isDynamicRangeFormatOfDolbyVisionOrHdrOrHlg(codecDynamicRangeFormat?: H265DynamicRangeFormat): boolean {
  return (
    codecDynamicRangeFormat == H265DynamicRangeFormat.HDR10 ||
    codecDynamicRangeFormat == H265DynamicRangeFormat.DOLBY_VISION ||
    codecDynamicRangeFormat == H265DynamicRangeFormat.HLG
  );
}

function logTaskErrors(task: Task): void {
  if (task == undefined) {
    return;
  }

  task.messages!.filter((msg) => msg.type === MessageType.ERROR).forEach((msg) => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
