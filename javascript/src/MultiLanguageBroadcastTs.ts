import ConfigProvider from '../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AclEntry,
  AclPermission,
  BroadcastTsAudioInputStreamConfiguration,
  BroadcastTsMuxing,
  BroadcastTsMuxingConfiguration,
  BroadcastTsVideoInputStreamConfiguration,
  CodecConfiguration,
  ConsoleLogger,
  Encoding,
  EncodingOutput,
  H264VideoConfiguration,
  HttpInput,
  Input,
  MessageType,
  Mp2AudioConfiguration,
  MuxingStream,
  Output,
  PresetConfiguration,
  S3Output,
  Status,
  Stream,
  StreamInput,
  StreamSelectionMode,
  Task
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how multiple audio streams can be included in a BroadcastTS muxing
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin platform
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input file.
 *       Example: http://my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file on the HTTP host. NOTE: This example
 *       will only work for files with at least two audio streams. Example: videos/1080p_Sintel.mp4
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path for the encoding output on your S3 output bucket.
 *       Example: /outputs
 * </ul>
 *
 * <p>Configuration parameters will be retrieved from these sources in the listed order:
 *
 * <ol>
 *   *
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz) *
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference) *
 *   <li>environment variables *
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference) *
 * </ol>
 */

const exampleName = 'MultiLanguageBroadcastTs';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  logger: new ConsoleLogger()
});

async function main() {
  const encoding = await createEncoding(exampleName, 'BroadcastTS muxing example with multiple audio streams');

  const input = await createHttpInput(configProvider.getHttpInputHost());
  const inputFilePath = configProvider.getHttpInputFilePath();

  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const videoConfiguration = await createH264VideoConfig();
  const videoStream = await createStream(
    encoding,
    input,
    inputFilePath,
    videoConfiguration,
    StreamSelectionMode.VIDEO_RELATIVE,
    0
  );

  const audioConfiguration = await createMp2AudioConfig();

  const audioStreams = new Map<string, Stream>();
  audioStreams.set(
    'eng',
    await createStream(encoding, input, inputFilePath, audioConfiguration, StreamSelectionMode.AUDIO_RELATIVE, 0)
  );
  audioStreams.set(
    'deu',
    await createStream(encoding, input, inputFilePath, audioConfiguration, StreamSelectionMode.AUDIO_RELATIVE, 1)
  );

  await createBroadcastTsMuxing(encoding, output, '/', videoStream, audioStreams);

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
 * Adds a video or audio stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param encoding The encoding to which the stream will be added
 * @param input The input resource providing the input file
 * @param inputPath The path to the input file
 * @param codecConfiguration The codec configuration to be applied to the stream
 * @param streamSelectionMode Specifies the strategy how the stream will be selected from an input
 *     file with multiple streams
 * @param position Depending on streamSelectionMode this specifies the absolute or relative
 *     position of the stream to be selected
 */
function createStream(
  encoding: Encoding,
  input: Input,
  inputPath: string,
  codecConfiguration: CodecConfiguration,
  streamSelectionMode: StreamSelectionMode,
  position: number
): Promise<Stream> {
  const streamInput = new StreamInput({
    inputId: input.id,
    inputPath: inputPath,
    selectionMode: streamSelectionMode,
    position: position
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
 * Creates a BroadcastTS muxing with one video and multiple audio streams
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsBroadcastTsByEncodingId
 *
 * @param encoding The encoding to which the muxing will be added
 * @param output The output resource to which the unencrypted segments will be written to
 * @param outputPath The output path where the unencrypted segments will be written to
 * @param videoStream The video stream to be included in the muxing
 * @param audioStreams A map of audio streams to be included in the muxing, with the key value
 *     specifying their language tag
 */
function createBroadcastTsMuxing(
  encoding: Encoding,
  output: Output,
  outputPath: string,
  videoStream: Stream,
  audioStreams: Map<string, Stream>
): Promise<BroadcastTsMuxing> {
  const audioMuxingStreams = Array.from(
    audioStreams.values(),
    audioStream => new MuxingStream({streamId: audioStream.id})
  );
  const videoMuxingStream = new MuxingStream({streamId: videoStream.id});

  let pid = 2000;
  const audioInputStreamConfigurations = Array.from(audioStreams, ([lang, audioStream]) => {
    return new BroadcastTsAudioInputStreamConfiguration({
      streamId: audioStream.id,
      packetIdentifier: pid++,
      language: lang
    });
  });

  const muxing = new BroadcastTsMuxing({
    name: exampleName,
    filename: 'broadcast.ts',
    segmentLength: 4.0,
    outputs: [buildEncodingOutput(output, outputPath)],
    streams: [videoMuxingStream, ...audioMuxingStreams],
    configuration: new BroadcastTsMuxingConfiguration({
      videoStreams: [new BroadcastTsVideoInputStreamConfiguration({streamId: videoStream.id})],
      audioStreams: audioInputStreamConfigurations
    })
  });

  return bitmovinApi.encoding.encodings.muxings.broadcastTs.create(encoding.id!, muxing);
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
    presetConfiguration: PresetConfiguration.VOD_HIGH_QUALITY,
    height: 1080,
    bitrate: 1500000
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the MP2 audio codec to be applied to audio streams
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioMp2
 */
function createMp2AudioConfig(): Promise<Mp2AudioConfiguration> {
  const config = new Mp2AudioConfiguration({
    name: 'MP2 96 kbit/s',
    bitrate: 96000
  });

  return bitmovinApi.encoding.configurations.audio.mp2.create(config);
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

  task.messages!.filter(msg => msg.type === MessageType.ERROR).forEach(msg => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
