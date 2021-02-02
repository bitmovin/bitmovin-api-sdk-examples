import ConfigProvider from '../common/ConfigProvider';
import BitmovinApi, {
  AacAudioConfiguration,
  AclEntry,
  AclPermission,
  AudioConfiguration,
  CodecConfiguration,
  ConsoleLogger,
  Encoding,
  EncodingOutput,
  Fmp4Muxing,
  H264VideoConfiguration,
  HttpInput,
  Input,
  MessageType,
  MuxingStream,
  Output,
  PresetConfiguration,
  RetryHint,
  S3Output,
  Status,
  Stream,
  StreamInput,
  StreamSelectionMode,
  Task,
  VideoConfiguration
} from '@bitmovin/api-sdk';
import {join} from 'path';

/**
 * This example demonstrates how to efficiently execute a large batch of encodings in parallel. In
 * order to keep the startup time for each encoding to a minimum, it is advisable to constantly have
 * some encodings queued. Encodings will therefore be started in a way to maintain a constant queue
 * size.
 *
 * <p>The same list of jobs will be executed on each start. In order to continue a batch after
 * restarting, you will have to extend the JobDispatcher class to use a persistent data store (e.g.
 * a database)
 *
 * <p>Be aware that our webhooks API provides a more advanced way to keep track of your encodings
 * than constantly polling their status. This approach has been chosen solely for reasons of
 * simplicity.
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
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
 *   <li>properties file located in the root folder of the JavaScript examples at ./examples.properties
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
  logger: new ConsoleLogger()
});
const exampleName = 'BatchEncoding';

/**
 * The example will strive to always keep this number of encodings in state 'queued'. Make sure
 * not to choose a size larger than your queue size limit in the Bitmovin platform, otherwise
 * encoding start calls will fail.
 */
const targetQueueSize = 3;

/**
 * The maximum number of retries per job, in case the start call or the encoding process is not
 * successful. However, no retries will be performed after receiving an error that is considered
 * permanent. Error code 8004 (platform queue limit exceeded) will always be retried.
 */
const maxRetries = 2;

async function main() {
  const input = await createHttpInput(configProvider.getHttpInputHost());
  const output = await createS3Output(
    configProvider.getS3OutputBucketName(),
    configProvider.getS3OutputAccessKey(),
    configProvider.getS3OutputSecretKey()
  );

  const codecConfigs = await createCodecConfigs();
  const jobDispatcher = new JobDispatcher();

  do {
    const queuedEncodingsCount = await countQueuedEncodings();
    const freeSlots = targetQueueSize - queuedEncodingsCount;

    if (freeSlots > 0) {
      const jobsToStart = jobDispatcher.getJobsToStart(freeSlots);

      if (jobsToStart.length > 0) {
        console.log(
          `There are currently ${queuedEncodingsCount} encodings queued. Starting ${jobsToStart.length} more to reach target queue size of ${targetQueueSize}`
        );

        await startEncodings(jobsToStart, codecConfigs, input, output);
      } else {
        console.log(`No more jobs to start. Waiting for ${jobDispatcher.getStartedJobs().length} jobs to finish.`);
      }
    } else {
      console.log(
        `There are currently ${queuedEncodingsCount}/${targetQueueSize} encodings queued. Waiting for free slots...`
      );
    }

    await timeout(10000);

    for (const job of jobDispatcher.getStartedJobs()) {
      await updateEncodingJob(job);
      await timeout(300);
    }
  } while (!jobDispatcher.allJobsFinished());
  console.log('All encoding jobs are finished!');
  jobDispatcher.logFailedJobs();
}

/**
 * This method queries the encodings currently in QUEUED state and returns the total result count
 * of that query
 */
async function countQueuedEncodings(): Promise<number> {
  const queuedEncodings = await bitmovinApi.encoding.encodings.list(q => q.status(Status.QUEUED));
  return queuedEncodings.totalCount || 0;
}

/**
 * This method will start new encodings created from {@link EncodingJob} objects and update the
 * started {@link EncodingJob} objects
 *
 * @param jobsToStart The encoding jobs that should be started
 * @param codecConfigs A list of codec configurations representing the different video- and audio
 *     renditions to be generated
 * @param input The input that should be used for that encodings
 * @param output The output that should be used for that encodings
 */
async function startEncodings(
  jobsToStart: EncodingJob[],
  codecConfigs: CodecConfiguration[],
  input: HttpInput,
  output: S3Output
): Promise<void> {
  for (const job of jobsToStart) {
    if (job.encodingId == undefined || job.encodingId === '') {
      const encoding = await createAndConfigureEncoding(
        input,
        job.inputFilePath,
        codecConfigs,
        job.encodingName,
        output,
        job.outputPath
      );
      job.encodingId = encoding.id!;
    }

    await bitmovinApi.encoding.encodings.start(job.encodingId).then(
      () => {
        job.status = EncodingJobStatus.STARTED;
        console.log(`Encoding ${job.encodingId} ('${job.encodingName}') has been started.`);
      },
      error => {
        if (error.errorCode === 8004) {
          console.log(
            `Encoding ${job.encodingId} ('${job.encodingName}') could not be started because your platform limit for queued encodings has been reached. Will retry.`
          );
          return;
        }

        job.retryCount++;
        if (job.retryCount > maxRetries) {
          console.error(
            `Encoding ${job.encodingId} ('${job.encodingName}') has reached the maximum number of retries. Giving up.`
          );
          job.status = EncodingJobStatus.GIVEN_UP;
          job.errorMessages.push('The encoding could not be started: ' + error.getMessage());
        }
      }
    );

    await timeout(300);
  }
}

/**
 * This checks the status of the associated encoding of the encoding job and would update the
 * encoding job in the repository.
 *
 * @param job The encoding job to update
 */
async function updateEncodingJob(job: EncodingJob): Promise<void> {
  const task = await bitmovinApi.encoding.encodings.status(job.encodingId);

  if (task.status === Status.FINISHED) {
    job.status = EncodingJobStatus.SUCCESSFUL;
  } else if (task.status === Status.ERROR) {
    if (!isRetryableError(task)) {
      console.error(`Encoding ${job.encodingId} ('${job.encodingName}') failed with a permanent error. Giving up.`);
      job.status = EncodingJobStatus.GIVEN_UP;
      Object.assign(job.errorMessages, getErrorMessages(task));
      return;
    }
    if (job.retryCount > maxRetries) {
      console.error(
        `Encoding ${job.encodingId} ('${job.encodingName}') has reached the maximum number of retries. Giving up.`
      );
      job.status = EncodingJobStatus.GIVEN_UP;
      Object.assign(job.errorMessages, getErrorMessages(task));
      return;
    }

    console.error(
      `Encoding ${job.encodingId} ('${job.encodingName}') has failed. Will attempt ${maxRetries -
        job.retryCount} more retries.`
    );
    job.retryCount++;
    job.status = EncodingJobStatus.WAITING;
  }
}

function isRetryableError(encodingTaskStatus: Task): boolean {
  return (
    encodingTaskStatus.status == Status.ERROR &&
    encodingTaskStatus.error != undefined &&
    encodingTaskStatus.error.retryHint != RetryHint.NO_RETRY
  );
}

function getErrorMessages(task: Task): string[] {
  if (task === undefined) {
    return [];
  }

  return task.messages!.filter(msg => msg.type === MessageType.ERROR).map(msg => msg.text!);
}

/**
 * Creates an Encoding object and adds a stream and a muxing for each codec configuration to it.
 * This creates a fully configured encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
 *
 * @param input The input that should be used for the encoding
 * @param inputPath The path to the input file which should be used for the encoding
 * @param codecConfigs A list of codec configurations representing the different video- and audio
 *     renditions to be generated
 * @param encodingName A name for the encoding
 * @param output The output that should be used for the encoding
 * @param outputPath The path where the content will be written to
 */
async function createAndConfigureEncoding(
  input: Input,
  inputPath: string,
  codecConfigs: CodecConfiguration[],
  encodingName: string,
  output: Output,
  outputPath: string
): Promise<Encoding> {
  let encoding = new Encoding({
    name: encodingName
  });

  encoding = await bitmovinApi.encoding.encodings.create(encoding);

  for (const codecConfig of codecConfigs) {
    const stream = await createStream(encoding, input, inputPath, codecConfig);

    let muxingOutputPath: string;

    if (codecConfig instanceof VideoConfiguration) {
      muxingOutputPath = `${outputPath}/video/${(codecConfig as VideoConfiguration).height}`;
    } else {
      muxingOutputPath = `${outputPath}/audio/${(codecConfig as AudioConfiguration).bitrate! / 1000}`;
    }

    await createFmp4Muxing(encoding, stream, output, muxingOutputPath);
  }

  return encoding;
}

/**
 * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
 * adaptive streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param encoding The encoding to add the FMP4 muxing to
 * @param stream The stream that is associated with the muxing
 * @param output The output that should be used for the muxing to write the segments to
 * @param outputPath The output path where the fragmented segments will be written to
 */
function createFmp4Muxing(encoding: Encoding, stream: Stream, output: Output, outputPath: string): Promise<Fmp4Muxing> {
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

/**
 * Creates a stream which binds an input file and input stream to a codec configuration. The
 * stream is used for muxings later on.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param encoding The encoding to add the stream to
 * @param input The input that should be used
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
    name: `H.264 ${height}`,
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
 * name of this example class and the given relative path
 *
 * <p>e.g.: /s3/base/path/ClassName/relative/path
 *
 * @param relativePath The relative path that is concatenated
 * @return The absolute path
 */
function buildAbsolutePath(relativePath: string): string {
  return join(configProvider.getS3OutputBasePath(), exampleName, relativePath);
}

function createCodecConfigs(): Promise<CodecConfiguration[]> {
  const videoConfig480 = createH264VideoConfig(480, 800000);
  const videoConfig720 = createH264VideoConfig(720, 1200000);
  const videoConfig1080 = createH264VideoConfig(1080, 2000000);
  const audioConfig = createAacAudioConfig();

  return Promise.all([videoConfig480, videoConfig720, videoConfig1080, audioConfig]);
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper class managing the encodings to be processed in the batch
 *
 * <p>NOTE: This is a dummy implementation that will process the same jobs on each execution of
 * the example. For production use, we suggest using a persistent data store (eg. a database) to
 * save and reload the job list.
 */
class JobDispatcher {
  private encodingJobs: EncodingJob[];

  constructor() {
    this.encodingJobs = [
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding1'),
        'encoding1'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding2'),
        'encoding2'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding3'),
        'encoding3'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding4'),
        'encoding4'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding5'),
        'encoding5'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding6'),
        'encoding6'
      ),
      new EncodingJob(
        configProvider.getHttpInputFilePath(),
        join(configProvider.getS3OutputBasePath(), 'encoding7'),
        'encoding7'
      )
    ];
  }

  getJobsToStart(limit: number): EncodingJob[] {
    return this.encodingJobs.filter(job => job.status === EncodingJobStatus.WAITING).slice(0, limit);
  }

  getStartedJobs(): EncodingJob[] {
    return this.encodingJobs.filter(job => job.status === EncodingJobStatus.STARTED);
  }

  allJobsFinished(): boolean {
    return (
      this.encodingJobs.filter(
        job => job.status === EncodingJobStatus.STARTED || job.status === EncodingJobStatus.WAITING
      ).length === 0
    );
  }

  logFailedJobs(): void {
    this.encodingJobs
      .filter(job => job.status == EncodingJobStatus.GIVEN_UP)
      .forEach(job => {
        console.error(
          `Encoding ${job.encodingId} (${job.encodingName}") could not be finished successfully: ${job.errorMessages}`
        );
      });
  }
}

/**
 * Helper class representing a single job in the batch, holding config values and keeping track of
 * its status
 */
class EncodingJob {
  public encodingName: string;
  public inputFilePath: string;
  public outputPath: string;
  public encodingId: string;
  public retryCount: number;
  public status: EncodingJobStatus;
  public errorMessages: string[] = [];

  constructor(inputFilePath: string, outputPath: string, encodingName: string) {
    this.inputFilePath = inputFilePath;
    this.outputPath = outputPath;
    this.encodingName = encodingName;
    this.status = EncodingJobStatus.WAITING;
  }
}

enum EncodingJobStatus {
  WAITING,
  STARTED,
  SUCCESSFUL,
  GIVEN_UP
}

main();
