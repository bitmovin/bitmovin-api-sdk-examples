import ConfigProvider from '../../common/ConfigProvider';
import {join} from 'path';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AudioMixChannelType,
  AudioMixInputChannelLayout,
  AudioMixInputStream,
  AudioMixInputStreamChannel,
  AudioMixInputStreamSourceChannel,
  AudioMixSourceChannelType,
  CodecConfiguration,
  ConsoleLogger,
  Encoding,
  EncodingOutput,
  H264VideoConfiguration,
  HttpInput,
  IngestInputStream,
  Input,
  InputStream,
  MessageType,
  Mp4Muxing,
  MuxingStream,
  Output,
  PresetConfiguration,
  S3Output,
  Status,
  Stream,
  StreamInput,
  StreamMode,
  StreamSelectionMode,
  Task,
} from '@bitmovin/api-sdk';

/**
 * This example demonstrates how to merge multiple stereo streams (from a single file, but this can
 * easily be extended to select them from separate input files), adjusting gain on the second stream
 * to turn it into a background effect.
 *
 * <p>This example illustrates one of the use cases in the [tutorial on audio manipulations]
 * (https://bitmovin.com/docs/encoding/tutorials/separating-and-combining-audio-streams)
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS - the path to a file containing a video with 2 stereo tracks
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

const exampleName = 'StreamMergingBackgroundAudio';

const configProvider: ConfigProvider = new ConfigProvider();

const bitmovinApi: BitmovinApi = new BitmovinApi({
  apiKey: configProvider.getBitmovinApiKey(),
  // uncomment the following line if you are working with a multi-tenant account
  // tenantOrgId: configProvider.getBitmovinTenantOrgId(),
  logger: new ConsoleLogger(),
});

async function main() {
  const encoding = await createEncoding(
    'Audio Mapping - Stream Merging',
    'Multiple stereo input tracks -> Output with single merged stereo track'
  );

  const input = await createHttpInput(configProvider.getHttpInputHost());

  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const h264Config = await createH264VideoConfig();
  const aacConfig = await createAacStereoAudioConfig();

  const inputFilePath = configProvider.getHttpInputFilePathWithTwoStereoTracks();
  const videoIngestInputStream = await createIngestInputStream(encoding, input, inputFilePath);

  const mainAudioIngestInputStream = await createIngestInputStreamForAudioTrack(encoding, input, inputFilePath, 0);
  const secondaryAudioIngestInputStream = await createIngestInputStreamForAudioTrack(encoding, input, inputFilePath, 1);

  let secondaryAudioMixInputStream = new AudioMixInputStream({
    channelLayout: AudioMixInputChannelLayout.CL_STEREO,
  });

  for (let i = 0; i <= 1; i++) {
    const sourceChannel = new AudioMixInputStreamSourceChannel({
      type: AudioMixSourceChannelType.CHANNEL_NUMBER,
      channelNumber: i,
      gain: 0.5,
    });

    const inputStreamChannel = new AudioMixInputStreamChannel({
      inputStreamId: secondaryAudioIngestInputStream.id,
      outputChannelType: AudioMixChannelType.CHANNEL_NUMBER,
      outputChannelNumber: i,
      sourceChannels: [sourceChannel],
    });

    secondaryAudioMixInputStream.audioMixChannels?.push(inputStreamChannel);
  }

  secondaryAudioMixInputStream = await bitmovinApi.encoding.encodings.inputStreams.audioMix.create(
    encoding.id!,
    secondaryAudioMixInputStream
  );

  const videoStream = await createStream(encoding, [videoIngestInputStream], h264Config);
  const audioStream = await createStream(
    encoding,
    [mainAudioIngestInputStream, secondaryAudioMixInputStream],
    aacConfig
  );

  await createMp4Muxing(encoding, output, '/', [videoStream, audioStream], 'stereo-track-merged.mp4');

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
    description: description,
  });

  return bitmovinApi.encoding.encodings.create(encoding);
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
 * Creates an IngestInputStream to select a specific audio track in the input, and adds it to an
 * encoding
 *
 * <p>The IngestInputStream is used to define where a file to read a stream from is located
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
 *
 * @param encoding The encoding to which the stream will be added
 * @param input The input resource providing the input file
 * @param inputPath The path to the input file
 * @param position The relative position of the audio track to select in the input file
 */
function createIngestInputStreamForAudioTrack(
  encoding: Encoding,
  input: Input,
  inputPath: string,
  position: number
): Promise<IngestInputStream> {
  const ingestInputStream = new IngestInputStream({
    inputId: input.id,
    inputPath: inputPath,
    selectionMode: StreamSelectionMode.AUDIO_RELATIVE,
    position: position,
  });

  return bitmovinApi.encoding.encodings.inputStreams.ingest.create(encoding.id!, ingestInputStream);
}

/**
 * Adds a video or audio stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param encoding The encoding to which the stream will be added
 * @param inputStreams The list of inputStream resources providing the input file, to be merged
 * @param codecConfiguration The codec configuration to be applied to the stream
 */
function createStream(
  encoding: Encoding,
  inputStreams: InputStream[],
  codecConfiguration: CodecConfiguration
): Promise<Stream> {
  const stream = new Stream({
    codecConfigId: codecConfiguration.id,
    mode: StreamMode.STANDARD,
  });

  for (const inputStream of inputStreams) {
    const streamInput = new StreamInput({
      inputStreamId: inputStream.id,
    });

    stream.inputStreams?.push(streamInput);
  }

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
    secretKey: secretKey,
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
 */
function createH264VideoConfig(): Promise<H264VideoConfiguration> {
  const config = new H264VideoConfiguration({
    name: 'H.264 1080p 1.5 Mbit/s',
    presetConfiguration: PresetConfiguration.VOD_STANDARD,
    height: 1080,
    bitrate: 1500000,
  });

  return bitmovinApi.encoding.configurations.video.h264.create(config);
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 */
function createAacStereoAudioConfig(): Promise<AacAudioConfiguration> {
  const config = new AacAudioConfiguration({
    name: 'AAC 128 kbit/s',
    bitrate: 128000,
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
    outputs: [buildEncodingOutput(output, outputPath)],
    filename: fileName,
  });

  for (const stream of streams) {
    const muxingStream = new MuxingStream({
      streamId: stream.id,
    });
    muxing.streams?.push(muxingStream);
  }

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
  task.messages!.filter((msg) => msg.type === MessageType.ERROR).forEach((msg) => console.error(msg.text));
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
