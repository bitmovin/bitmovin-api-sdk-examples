import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.common.BitmovinException;
import com.bitmovin.api.sdk.encoding.encodings.EncodingListQueryParams;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.AudioConfiguration;
import com.bitmovin.api.sdk.model.CodecConfiguration;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H264VideoConfiguration;
import com.bitmovin.api.sdk.model.HttpInput;
import com.bitmovin.api.sdk.model.Input;
import com.bitmovin.api.sdk.model.Message;
import com.bitmovin.api.sdk.model.MessageType;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.PaginationResponse;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.RetryHint;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.StartEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import com.bitmovin.api.sdk.model.VideoConfiguration;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
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
 *   <li>properties file located in the root folder of the JAVA examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */
public class BatchEncoding {
  private static final Logger logger = LoggerFactory.getLogger(BatchEncoding.class);

  private static BitmovinApi bitmovinApi;
  private static ConfigProvider configProvider;

  /**
   * The example will strive to always keep this number of encodings in state 'queued'. Make sure
   * not to choose a size larger than your queue size limit in the Bitmovin platform, otherwise
   * encoding start calls will fail.
   */
  private static int targetQueueSize = 3;

  /**
   * The maximum number of retries per job, in case the start call or the encoding process is not
   * successful. However, no retries will be performed after receiving an error that is considered
   * permanent. Error code 8004 (platform queue limit exceeded) will always be retried.
   */
  private static int maxRetries = 2;

  public static void main(String[] args) throws Exception {
    configProvider = new ConfigProvider(args);
    bitmovinApi =
        BitmovinApi.builder()
            .withApiKey(configProvider.getBitmovinApiKey())
            // uncomment the following line if you are working with a multi-tenant account
            // .withTenantOrgId(configProvider.getBitmovinTenantOrgId())
            .withLogger(
                new Slf4jLogger(), Level.BASIC) // set the logger and log level for the API client
            .build();

    HttpInput input = createHttpInput(configProvider.getHttpInputHost());
    Output output =
        createS3Output(
            configProvider.getS3OutputBucketName(),
            configProvider.getS3OutputAccessKey(),
            configProvider.getS3OutputSecretKey());

    List<CodecConfiguration> codecConfigs =
        Arrays.asList(
            createH264VideoConfig(480, 800_000L),
            createH264VideoConfig(720, 1_200_000L),
            createH264VideoConfig(1080, 2_000_000L),
            createAacAudioConfig());

    JobDispatcher jobDispatcher = new JobDispatcher();

    do {
      long queuedEncodingsCount = countQueuedEncodings();
      long freeSlots = targetQueueSize - queuedEncodingsCount;
      if (freeSlots > 0) {
        List<EncodingJob> jobsToStart = jobDispatcher.getJobsToStart(freeSlots);

        if (!jobsToStart.isEmpty()) {
          logger.info(
              "There are currently {} encodings queued. Starting {} more to reach target queue size of {}",
              queuedEncodingsCount,
              jobsToStart.size(),
              targetQueueSize);
          startEncodings(jobsToStart, codecConfigs, input, output);
        } else {
          logger.info(
              "No more jobs to start. Waiting for {} jobs to finish.",
              jobDispatcher.getStartedJobs().size());
        }
      } else {
        logger.info(
            "There are currently {} encodings queued. Waiting for free slots...",
            queuedEncodingsCount,
            targetQueueSize);
      }

      Thread.sleep(10000);
      for (EncodingJob job : jobDispatcher.getStartedJobs()) {
        updateEncodingJob(job);
        Thread.sleep(300);
      }
    } while (!jobDispatcher.allJobsFinished());
    logger.info("All encoding jobs are finished!");

    jobDispatcher.logFailedJobs();
  }

  /**
   * This method queries the encodings currently in QUEUED state and returns the total result count
   * of that query
   */
  private static long countQueuedEncodings() throws BitmovinException {
    EncodingListQueryParams queryParams = new EncodingListQueryParams();
    queryParams.setStatus(Status.QUEUED.toString());

    PaginationResponse<Encoding> encodingPage = bitmovinApi.encoding.encodings.list(queryParams);
    return encodingPage.getTotalCount();
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
  private static void startEncodings(
      List<EncodingJob> jobsToStart,
      List<CodecConfiguration> codecConfigs,
      Input input,
      Output output)
      throws BitmovinException, InterruptedException {
    for (EncodingJob job : jobsToStart) {
      if (StringUtils.isBlank(job.encodingId)) {
        Encoding encoding =
            createAndConfigureEncoding(
                input, job.inputFilePath, codecConfigs, job.encodingName, output, job.outputPath);
        job.encodingId = encoding.getId();
      }
      try {
        bitmovinApi.encoding.encodings.start(job.encodingId, new StartEncodingRequest());
        job.status = EncodingJobStatus.STARTED;
        logger.info("Encoding {} ('{}') has been started.", job.encodingId, job.encodingName);
      } catch (BitmovinException ex) {

        if (ex.getErrorCode() == 8004) {
          logger.warn(
              "Encoding {} ('{}') could not be started because your platform limit for queued encodings has been reached. Will retry.",
              job.encodingId,
              job.encodingName);
          return;
        }

        job.retryCount++;
        if (job.retryCount > maxRetries) {
          logger.error(
              "Encoding {} ('{}') has reached the maximum number of retries. Giving up.",
              job.encodingId,
              job.encodingName);
          job.status = EncodingJobStatus.GIVEN_UP;
          job.errorMessages.add("The encoding could not be started: " + ex.getMessage());
        }
      }
      Thread.sleep(300);
    }
  }

  /**
   * This checks the status of the associated encoding of the encoding job and would update the
   * encoding job in the repository.
   *
   * @param job The encoding job to update
   */
  private static void updateEncodingJob(EncodingJob job) throws BitmovinException {
    Task task = bitmovinApi.encoding.encodings.status(job.encodingId);

    if (task.getStatus() == Status.FINISHED) {
      job.status = EncodingJobStatus.SUCCESSFUL;
    } else if (task.getStatus() == Status.ERROR) {
      if (!isRetryableError(task)) {
        logger.error(
            "Encoding {} ('{}') failed with a permanent error. Giving up.",
            job.encodingId,
            job.encodingName);
        job.status = EncodingJobStatus.GIVEN_UP;
        job.errorMessages.addAll(getErrorMessages(task));
        return;
      }
      if (job.retryCount > maxRetries) {
        logger.error(
            "Encoding {} ('{}') has reached the maximum number of retries. Giving up.",
            job.encodingId,
            job.encodingName);
        job.status = EncodingJobStatus.GIVEN_UP;
        job.errorMessages.addAll(getErrorMessages(task));
        return;
      }

      logger.error(
          "Encoding {} ('{}') has failed. Will attempt {} more retries.",
          job.encodingId,
          job.encodingName,
          maxRetries - job.retryCount);
      job.retryCount++;
      job.status = EncodingJobStatus.WAITING;
    }
  }

  private static boolean isRetryableError(Task encodingTaskStatus) {
    return encodingTaskStatus.getStatus() == Status.ERROR
        && encodingTaskStatus.getError() != null
        && encodingTaskStatus.getError().getRetryHint() != RetryHint.NO_RETRY;
  }

  private static List<String> getErrorMessages(Task task) {
    return task.getMessages().stream()
        .filter(msg -> msg.getType() == MessageType.ERROR)
        .map(Message::getText)
        .collect(Collectors.toList());
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
   */
  private static Encoding createAndConfigureEncoding(
      Input input,
      String inputPath,
      List<CodecConfiguration> codecConfigs,
      String encodingName,
      Output output,
      String outputPath)
      throws BitmovinException {
    Encoding encoding = new Encoding();
    encoding.setName(encodingName);

    encoding = bitmovinApi.encoding.encodings.create(encoding);

    for (CodecConfiguration codecConfig : codecConfigs) {
      Stream stream = createStream(encoding, input, inputPath, codecConfig);

      String muxingOutputPath;
      if (codecConfig instanceof VideoConfiguration) {
        muxingOutputPath =
            String.format(
                "%s/video/%s", outputPath, ((VideoConfiguration) codecConfig).getHeight());
      } else {
        muxingOutputPath =
            String.format(
                "%s/audio/%s", outputPath, ((AudioConfiguration) codecConfig).getBitrate() / 1000);
      }
      createFmp4Muxing(encoding, stream, output, muxingOutputPath);
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
  private static Fmp4Muxing createFmp4Muxing(
      Encoding encoding, Stream stream, Output output, String outputPath) throws BitmovinException {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    Fmp4Muxing muxing = new Fmp4Muxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);
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
  private static Stream createStream(
      Encoding encoding, Input input, String inputPath, CodecConfiguration codecConfiguration)
      throws BitmovinException {

    StreamInput streamInput = new StreamInput();
    streamInput.setInputId(input.getId());
    streamInput.setInputPath(inputPath);
    streamInput.setSelectionMode(StreamSelectionMode.AUTO);

    Stream stream = new Stream();
    stream.addInputStreamsItem(streamInput);
    stream.setCodecConfigId(codecConfiguration.getId());

    return bitmovinApi.encoding.encodings.streams.create(encoding.getId(), stream);
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
  private static H264VideoConfiguration createH264VideoConfig(int height, long bitrate)
      throws BitmovinException {
    H264VideoConfiguration config = new H264VideoConfiguration();
    config.setName(String.format("H.264 %dp", height));
    config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
    config.setHeight(height);
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.video.h264.create(config);
  }

  /**
   * Creates a configuration for the AAC audio codec to be applied to audio streams.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
   */
  private static AacAudioConfiguration createAacAudioConfig() throws BitmovinException {
    AacAudioConfiguration config = new AacAudioConfiguration();
    config.setName("AAC 128 kbit/s");
    config.setBitrate(128_000L);

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
  private static HttpInput createHttpInput(String host) throws BitmovinException {
    HttpInput input = new HttpInput();
    input.setHost(host);

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
  private static S3Output createS3Output(String bucketName, String accessKey, String secretKey)
      throws BitmovinException {
    S3Output s3Output = new S3Output();
    s3Output.setBucketName(bucketName);
    s3Output.setAccessKey(accessKey);
    s3Output.setSecretKey(secretKey);

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
  private static EncodingOutput buildEncodingOutput(Output output, String outputPath) {
    AclEntry aclEntry = new AclEntry();
    aclEntry.setPermission(AclPermission.PUBLIC_READ);

    EncodingOutput encodingOutput = new EncodingOutput();
    encodingOutput.setOutputPath(buildAbsolutePath(outputPath));
    encodingOutput.setOutputId(output.getId());
    encodingOutput.addAclItem(aclEntry);
    return encodingOutput;
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
  public static String buildAbsolutePath(String relativePath) {
    String className = BatchEncoding.class.getSimpleName();
    return Paths.get(configProvider.getS3OutputBasePath(), className, relativePath).toString();
  }

  /**
   * Helper class managing the encodings to be processed in the batch
   *
   * <p>NOTE: This is a dummy implementation that will process the same jobs on each execution of
   * the example. For production use, we suggest using a persistent data store (eg. a database) to
   * save and reload the job list.
   */
  private static class JobDispatcher {

    private static List<EncodingJob> encodingJobs;

    public JobDispatcher() {
      encodingJobs =
          Arrays.asList(
              new EncodingJob(
                  "/path/to/your/input/file1.mkv", "/path/to/your/output/encoding1", "encoding1"),
              new EncodingJob(
                  "/path/to/your/input/file2.mkv", "/path/to/your/output/encoding2", "encoding2"),
              new EncodingJob(
                  "/path/to/your/input/file3.mkv", "/path/to/your/output/encoding3", "encoding3"),
              new EncodingJob(
                  "/path/to/your/input/file4.mkv", "/path/to/your/output/encoding4", "encoding4"),
              new EncodingJob(
                  "/path/to/your/input/file5.mkv", "/path/to/your/output/encoding5", "encoding5"),
              new EncodingJob(
                  "/path/to/your/input/file6.mkv", "/path/to/your/output/encoding6", "encoding6"),
              new EncodingJob(
                  "/path/to/your/input/file7.mkv", "/path/to/your/output/encoding7", "encoding7"));
    }

    public List<EncodingJob> getJobsToStart(long limit) {
      return encodingJobs.stream()
          .filter(job -> job.status == EncodingJobStatus.WAITING)
          .limit(limit)
          .collect(Collectors.toList());
    }

    public List<EncodingJob> getStartedJobs() {
      return encodingJobs.stream()
          .filter(job -> job.status == EncodingJobStatus.STARTED)
          .collect(Collectors.toList());
    }

    public boolean allJobsFinished() {
      return encodingJobs.stream()
          .allMatch(
              job ->
                  job.status == EncodingJobStatus.SUCCESSFUL
                      || job.status == EncodingJobStatus.GIVEN_UP);
    }

    public void logFailedJobs() {
      encodingJobs.stream()
          .filter(job -> job.status == EncodingJobStatus.GIVEN_UP)
          .forEach(
              encodingJob ->
                  logger.error(
                      "Encoding {} ('{}') could not be finished successfully: {}",
                      encodingJob.encodingId,
                      encodingJob.encodingName,
                      encodingJob.errorMessages));
    }
  }

  /**
   * Helper class representing a single job in the batch, holding config values and keeping track of
   * its status
   */
  private static class EncodingJob {

    private String encodingName;
    private String inputFilePath;
    private String outputPath;
    private String encodingId;
    private int retryCount;
    private EncodingJobStatus status;
    private List<String> errorMessages = new ArrayList<>();

    private EncodingJob(String inputFilePath, String outputPath, String encodingName) {
      this.inputFilePath = inputFilePath;
      this.outputPath = outputPath;
      this.encodingName = encodingName;
      this.status = EncodingJobStatus.WAITING;
    }
  }

  public enum EncodingJobStatus {
    WAITING,
    STARTED,
    SUCCESSFUL,
    GIVEN_UP
  }
}
