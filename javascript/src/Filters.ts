import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  CodecConfiguration,
  ConsoleLogger,
  DeinterlaceFilter,
  Encoding,
  EncodingOutput,
  Filter,
  H264VideoConfiguration,
  HttpInput,
  Input,
  MessageType,
  Mp4Muxing,
  MuxingStream,
  Output,
  PresetConfiguration,
  S3Output,
  Status,
  Stream,
  StreamFilter,
  StreamFilterList,
  StreamInput,
  Task,
  TextFilter,
  WatermarkFilter
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how to apply filters to a video stream.
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
 *       videos/1080p_Sintel.mp4
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 *       Example: /outputs
 *   <li>WATERMARK_IMAGE_PATH - The path to the watermark image. Example:
 *       http://my-storage.biz/logo.png
 *   <li>TEXT_FILTER_TEXT - The text to be displayed by the text filter
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

const exampleName = 'Filters';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding = await createEncoding(exampleName, 'Encoding with multiple filters applied to the video stream');

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

  const watermarkFilter = await createWatermarkFilter();
  const textFilter = await createTextFilter();
  const deinterlaceFilter = await createDeinterlaceFilter();

  await createStreamFilters(encoding, videoStream, [watermarkFilter, textFilter, deinterlaceFilter]);

  await createMp4Muxing(encoding, output, '/', [videoStream, audioStream], 'filters_applied.mp4');

  await executeEncoding(encoding);
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
 * Creates a watermark filter which displays the watermark image in the top left corner of the
 * video
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersEnhancedWatermark
 */
function createWatermarkFilter(): Promise<WatermarkFilter> {
  const watermarkFilter = new WatermarkFilter({
    image: configProvider.getWatermarkImagePath(),
    top: 10,
    left: 10
  });

  return bitmovinApi.encoding.filters.watermark.create(watermarkFilter);
}

/**
 * Creates a text filter which displays the given text in the center of the video. X and Y
 * positions are defined by the expressions "main_w / 2" and "main_h / 2", which mean half of the
 * video"s width and height.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersText
 */
function createTextFilter(): Promise<TextFilter> {
  const textFilter = new TextFilter({
    text: configProvider.getTextFilterText(),
    x: 'main_w / 2',
    y: 'main_h / 2'
  });

  return bitmovinApi.encoding.filters.text.create(textFilter);
}

/**
 * Creates a deinterlace filter, which converts <a
 * href="https://en.wikipedia.org/wiki/Interlaced_video">interlaced</a> to <a
 * href="https://en.wikipedia.org/wiki/Progressive_scan">progressive</a> video. HLS <a
 * href="https://bitmovin.com/rfc-compliant-hls-content-create/">requires deinterlaced video</a>.
 * The filter has no effect if the input is already progressive.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersDeinterlace
 */
function createDeinterlaceFilter(): Promise<DeinterlaceFilter> {
  return bitmovinApi.encoding.filters.deinterlace.create(new DeinterlaceFilter());
}

/**
 * Creates a list of the previously configured filter resources and adds them to a video stream.
 * The <i>position</i> property of each StreamFilter determines the order in which they are
 * applied.
 *
 * @param encoding The encoding to which the video stream belongs to
 * @param stream The video stream to apply the filters to
 * @param filters A list of filter resources that have been created previously
 */
function createStreamFilters(encoding: Encoding, stream: Stream, filters: Filter[]): Promise<StreamFilterList> {
  const streamFilters: StreamFilter[] = new Array(filters.length);

  for (let i = 0; i < filters.length; i++) {
    streamFilters[i] = new StreamFilter({
      id: filters[i].id,
      position: i
    });
  }

  return bitmovinApi.encoding.encodings.streams.filters.create(encoding.id!, stream.id!, streamFilters);
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
 * Creates an MP4 muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId
 *
 * @param encoding The encoding to add the MP4 muxing to
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragments will be written to
 * @param streams A list of streams to be added to the muxing
 * @param fileName The name of the file that will be written to the output
 */
function createMp4Muxing(
  encoding: Encoding,
  output: Output,
  outputPath: string,
  streams: Stream[],
  fileName: string
): Promise<Mp4Muxing> {
  const muxing = new Mp4Muxing({
    filename: fileName,
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: streams.map(stream => new MuxingStream({streamId: stream.id}))
  });

  return bitmovinApi.encoding.encodings.muxings.mp4.create(encoding.id!, muxing);
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
function buildAbsolutePath(relativePath: string) {
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
    presetConfiguration: PresetConfiguration.VOD_HIGH_QUALITY,
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

function logTaskErrors(task: Task): void {
  if (task.messages == undefined) {
    return;
  }
  task.messages.filter(msg => msg.type === MessageType.ERROR).forEach(msg => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
