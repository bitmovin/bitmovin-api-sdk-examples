package tutorials;

import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.common.BitmovinException;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.CodecConfiguration;
import com.bitmovin.api.sdk.model.DashManifest;
import com.bitmovin.api.sdk.model.DashManifestDefault;
import com.bitmovin.api.sdk.model.DashManifestDefaultVersion;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H264VideoConfiguration;
import com.bitmovin.api.sdk.model.HlsManifest;
import com.bitmovin.api.sdk.model.HlsManifestDefault;
import com.bitmovin.api.sdk.model.HlsManifestDefaultVersion;
import com.bitmovin.api.sdk.model.Input;
import com.bitmovin.api.sdk.model.LiveAutoShutdownConfiguration;
import com.bitmovin.api.sdk.model.LiveDashManifest;
import com.bitmovin.api.sdk.model.LiveEncoding;
import com.bitmovin.api.sdk.model.LiveHlsManifest;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.SrtInput;
import com.bitmovin.api.sdk.model.SrtMode;
import com.bitmovin.api.sdk.model.StartLiveEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Scanner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This example shows how to configure and start a live encoding using default DASH and HLS
 * manifests. For more information see: https://bitmovin.com/live-encoding-live-streaming/
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 *       Example: /outputs
 * </ul>
 *
 * <p>Configuration parameters will be retrieved from these sources in the listed order: *
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
public class SrtLiveEncoding {

  private static final Logger logger = LoggerFactory.getLogger(SrtLiveEncoding.class);

  private static BitmovinApi bitmovinApi;
  private static ConfigProvider configProvider;

  /**
   * Make sure to set the correct resolution of your input video, so the aspect ratio can be
   * calculated.
   */
  private static final int inputVideoWidth = 1920;

  private static final int inputVideoHeight = 1080;
  private static final double aspectRatio = inputVideoWidth / (double) inputVideoHeight;

  private static final int maxMinutesToWaitForLiveEncodingDetails = 5;
  private static final int maxMinutesToWaitForEncodingStatus = 5;

  /** This list defines the video renditions that will be generated */
  private static List<VideoConfig> videoProfile =
      Arrays.asList(
          new VideoConfig("H.264 480p live", 800_000L, 480, "/video/480p"),
          new VideoConfig("H.264 720p live", 1_200_000L, 720, "/video/720p"),
          new VideoConfig("H.264 1080p live", 3_000_000L, 1080, "/video/1080p"));

  /** This list defines the audio renditions that will be generated */
  private static List<AudioConfig> audioProfile =
      Collections.singletonList(new AudioConfig("128kbit", 128_000L, "/audio/128kb"));

  /**
   * Automatically shutdown the live stream if there is no input anymore for a predefined number of seconds.
   */
  private static long bytesReadTimeoutSeconds = 3600; // 1 hour

  /**
   * Automatically shutdown the live stream after a predefined runtime in minutes.
   */
  private static long streamTimeoutMinutes = 12 * 60; // 12 hours

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

    Encoding encoding =
        createEncoding(
            "Live Encoding Test with SRT Input Listener Mode",
            "Live encoding with HLS and DASH manifest");
    SrtInput input = createSrtInput(SrtMode.LISTENER, 2088, null);
    Output output =
        createS3Output(
            configProvider.getS3OutputBucketName(),
            configProvider.getS3OutputAccessKey(),
            configProvider.getS3OutputSecretKey());

    for (VideoConfig videoConfig : videoProfile) {
      H264VideoConfiguration h264Config =
          createH264VideoConfig(videoConfig.name, videoConfig.height, videoConfig.bitRate);
      Stream stream = createStream(encoding, input, h264Config);

      createFmp4Muxing(encoding, stream, output, videoConfig.outputPath);
    }

    for (AudioConfig audioConfig : audioProfile) {
      AacAudioConfiguration aacConfig = createAacAudioConfig(audioConfig.name, audioConfig.bitrate);
      Stream audioStream = createStream(encoding, input, aacConfig);

      createFmp4Muxing(encoding, audioStream, output, audioConfig.outputPath);
    }

    DashManifest dashManifest = createDefaultDashManifest(output, "/", encoding);
    HlsManifest hlsManifest = createHlsDefaultManifest(output, "/", encoding);

    LiveDashManifest liveDashManifest = new LiveDashManifest();
    liveDashManifest.setManifestId(dashManifest.getId());
    liveDashManifest.setTimeshift(300D);
    liveDashManifest.setLiveEdgeOffset(90D);

    LiveHlsManifest liveHlsManifest = new LiveHlsManifest();
    liveHlsManifest.setManifestId(hlsManifest.getId());
    liveHlsManifest.setTimeshift(300D);

    StartLiveEncodingRequest startRequest = new StartLiveEncodingRequest();
    startRequest.addDashManifestsItem(liveDashManifest);
    startRequest.addHlsManifestsItem(liveHlsManifest);

    /*
     Setting the autoShutdownConfiguration is optional,
     if omitted the live encoding will not shut down automatically.
     */
    LiveAutoShutdownConfiguration autoShutdownConfiguration = new LiveAutoShutdownConfiguration();
    autoShutdownConfiguration.setBytesReadTimeoutSeconds(bytesReadTimeoutSeconds);
    autoShutdownConfiguration.setStreamTimeoutMinutes(streamTimeoutMinutes);
    startRequest.setAutoShutdownConfiguration(autoShutdownConfiguration);

    startLiveEncodingAndWaitUntilRunning(encoding, startRequest);
    LiveEncoding liveEncoding = waitForLiveEncodingDetails(encoding);

    logger.info(
        "Live encoding is up and ready for ingest. SRT URL: srt://{}:{}",
        liveEncoding.getEncoderIp(),
        input.getPort());

    /*
    This will enable you to shut down the live encoding from within your script.
    In production, it is naturally recommended to stop the encoding by using the Bitmovin dashboard
    or an independent API call - https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStopByEncodingId
    */
    Scanner scanner = new Scanner(System.in);
    logger.info("Press Enter to shutdown the live encoding...");
    scanner.nextLine();

    logger.info("Shutting down live encoding!");
    bitmovinApi.encoding.encodings.live.stop(encoding.getId());
    waitUntilEncodingIsInState(encoding, Status.FINISHED);
  }

  /**
   * Tries to get the live details of the encoding. It could take a few minutes until this info is
   * available.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsLiveByEncodingId
   *
   * @param encoding The encoding for which the live encoding details should be retrieved
   */
  private static LiveEncoding waitForLiveEncodingDetails(Encoding encoding)
      throws InterruptedException {

    logger.info(
        "Waiting until live encoding details are available (max {} minutes) ...",
        maxMinutesToWaitForLiveEncodingDetails);

    int checkIntervalInSeconds = 10;
    int maxAttempts = maxMinutesToWaitForLiveEncodingDetails * (60 / checkIntervalInSeconds);
    int attempt = 0;

    BitmovinException bitmovinException;

    do {
      try {
        return bitmovinApi.encoding.encodings.live.get(encoding.getId());
      } catch (BitmovinException e) {
        attempt++;
        bitmovinException = e;
        Thread.sleep(checkIntervalInSeconds * (long) 1000);
      }
    } while (attempt < maxAttempts);
    throw new Error(
        String.format(
            "Failed to retrieve live encoding details within %d minutes. Aborting.",
            maxMinutesToWaitForLiveEncodingDetails),
        bitmovinException);
  }

  /**
   * Periodically checks the status of the encoding.
   *
   * <p>Note: You can also use our webhooks API instead of polling the status. For more information
   * checkout the API spec:
   * https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
   *
   * @param encoding The encoding that should have the expected status
   * @param expectedStatus The expected status the provided encoding should have. See {@link Status}
   */
  private static void waitUntilEncodingIsInState(Encoding encoding, Status expectedStatus)
      throws InterruptedException, BitmovinException {

    logger.info(
        "Waiting for encoding to have status {} (max {} minutes) ...",
        expectedStatus,
        maxMinutesToWaitForEncodingStatus);

    int checkIntervalInSeconds = 10;
    int maxAttempts = maxMinutesToWaitForEncodingStatus * (60 / checkIntervalInSeconds);
    int attempt = 0;

    Task task;
    do {
      task = bitmovinApi.encoding.encodings.status(encoding.getId());
      logger.info("Encoding with id {} has status: {}", encoding.getId(), task.getStatus());
      if (task.getStatus() == Status.ERROR) {
        throw new Error(
            String.format(
                "Error while waiting for encoding with ID %s to have the status %s",
                encoding.getId(), expectedStatus));
      }
      if (task.getStatus() == expectedStatus) {
        return;
      }
      Thread.sleep(checkIntervalInSeconds * (long) 1000);
    } while (attempt++ < maxAttempts);
    throw new Error(
        String.format(
            "Live encoding did not switch to state %s within %d minutes. Aborting.",
            expectedStatus, maxMinutesToWaitForEncodingStatus));
  }

  /**
   * This method starts the live encoding
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStartByEncodingId
   *
   * @param encoding The encoding that should be started and checked until it is running
   * @param startEncodingRequest The request object that is sent with the start call
   */
  private static void startLiveEncodingAndWaitUntilRunning(
      Encoding encoding, StartLiveEncodingRequest startEncodingRequest)
      throws InterruptedException, BitmovinException {
    startEncodingRequest.setStreamKey("srtlive");
    bitmovinApi.encoding.encodings.live.start(encoding.getId(), startEncodingRequest);
    waitUntilEncodingIsInState(encoding, Status.RUNNING);
  }

  /**
   * Creates a default DASH manifest that automatically includes all the representations configured.
   * in the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
   *
   * @param output The output to which the manifest should be written
   * @param outputPath The path where the generated manifest should be located
   * @param encoding The encoding for which the manifest should be generated
   */
  private static DashManifestDefault createDefaultDashManifest(
      Output output, String outputPath, Encoding encoding) {
    DashManifestDefault dashManifestDefault = new DashManifestDefault();
    dashManifestDefault.setEncodingId(encoding.getId());
    dashManifestDefault.setManifestName("stream.mpd");
    dashManifestDefault.setVersion(DashManifestDefaultVersion.V1);
    dashManifestDefault.addOutputsItem(buildEncodingOutput(output, outputPath));

    return bitmovinApi.encoding.manifests.dash.defaultapi.create(dashManifestDefault);
  }

  /**
   * Creates a default HLS manifest that automatically includes all representations configured in.
   * the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
   *
   * @param output The output to which the manifest should be written
   * @param outputPath The path where the generated manifest should be located
   * @param encoding The encoding for which the manifest should be generated
   */
  private static HlsManifestDefault createHlsDefaultManifest(
      Output output, String outputPath, Encoding encoding) {
    HlsManifestDefault hlsManifestDefault = new HlsManifestDefault();
    hlsManifestDefault.setEncodingId(encoding.getId());
    hlsManifestDefault.addOutputsItem(buildEncodingOutput(output, outputPath));
    hlsManifestDefault.setName("master.m3u8");
    hlsManifestDefault.setVersion(HlsManifestDefaultVersion.V1);

    return bitmovinApi.encoding.manifests.hls.defaultapi.create(hlsManifestDefault);
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
    String className = SrtLiveEncoding.class.getSimpleName();
    return Paths.get(configProvider.getS3OutputBasePath(), className, relativePath).toString();
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
  private static void createFmp4Muxing(
      Encoding encoding, Stream stream, Output output, String outputPath) throws BitmovinException {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    Fmp4Muxing muxing = new Fmp4Muxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);
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
   * Creates an SRT input.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingInputsSrt
   *
   * @param mode SRT mode (either CALLER or LISTENER)
   * @param port UDP port where the LISTENER listens for the CALLER.
   * @param host if mode is CALLER then host is the contributor's IP address. Otherwise host must be
   *     null
   */
  private static SrtInput createSrtInput(SrtMode mode, int port, String host)
      throws BitmovinException {
    SrtInput srtInput = new SrtInput();
    srtInput.setMode(mode);
    srtInput.setHost(host);
    srtInput.setPort(port);

    return bitmovinApi.encoding.inputs.srt.create(srtInput);
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
   * Creates an Encoding object. This is the base object to configure your encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
   *
   * @param name This is the name of the encoding
   * @param description This is the description of the encoding
   */
  private static Encoding createEncoding(String name, String description) throws BitmovinException {
    Encoding encoding = new Encoding();
    encoding.setName(name);
    encoding.setDescription(description);

    return bitmovinApi.encoding.encodings.create(encoding);
  }

  /**
   * Creates a stream which binds an input file to a codec configuration. The stream is used later
   * for muxings. For RTMP live inputs, the input path should be the application name and the
   * position of the input streams must be provided.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
   *
   * @param encoding The encoding where to add the stream to
   * @param input The input where the input file is located
   * @param codecConfiguration The codec configuration to be applied to the stream
   */
  private static Stream createStream(
      Encoding encoding, Input input, CodecConfiguration codecConfiguration)
      throws BitmovinException {
    StreamInput streamInput = new StreamInput();
    streamInput.setInputId(input.getId());
    streamInput.setInputPath("live");
    streamInput.setSelectionMode(StreamSelectionMode.AUTO);

    Stream stream = new Stream();
    stream.addInputStreamsItem(streamInput);
    stream.setCodecConfigId(codecConfiguration.getId());

    return bitmovinApi.encoding.encodings.streams.create(encoding.getId(), stream);
  }

  /**
   * Creates a configuration for the H.264 video codec to be applied to video streams.
   *
   * <p>To keep things simple, we use a quality-optimized live preset configuration, which will
   * apply proven settings for the codec. See <a
   * href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
   * to optimize your H264 codec configuration for different use-cases</a> for alternative presets.
   *
   * @param name The name of the configuration resource being created
   * @param height The height of the output video
   * @param bitrate The target bitrate of the output video
   */
  private static H264VideoConfiguration createH264VideoConfig(String name, int height, long bitrate)
      throws BitmovinException {
    H264VideoConfiguration config = new H264VideoConfiguration();
    config.setName(name);
    config.setPresetConfiguration(PresetConfiguration.LIVE_STANDARD);
    config.setHeight(height);
    config.setWidth((int) Math.ceil(aspectRatio * height));
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.video.h264.create(config);
  }

  /**
   * Creates a configuration for the AAC audio codec to be applied to audio streams.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
   *
   * @param name The name of the configuration resource being created
   * @param bitrate The target bitrate for the encoded audio
   */
  private static AacAudioConfiguration createAacAudioConfig(String name, long bitrate) throws BitmovinException {
    AacAudioConfiguration config = new AacAudioConfiguration();
    config.setName(name);
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.audio.aac.create(config);
  }

  private static class VideoConfig {
    private String name;
    private Long bitRate;
    private Integer height;
    private String outputPath;

    /**
     * @param name The name of the video configuration
     * @param bitRate The target output bitrate of the video configuration
     * @param height The target output height of the video configuration
     * @param outputPath The output path for this video configuration
     */
    private VideoConfig(
        String name, Long bitRate, Integer height, String outputPath) {
      this.name = name;
      this.bitRate = bitRate;
      this.height = height;
      this.outputPath = outputPath;
    }
  }

  private static class AudioConfig {
    private String name;
    private Long bitrate;
    private String outputPath;

    /**
     * @param name The name of the audio configuration
     * @param bitrate The target output bitrate of the audio configuration
     * @param outputPath The output path for this audio configuration
     */
    public AudioConfig(String name, Long bitrate, String outputPath) {
      this.name = name;
      this.bitrate = bitrate;
      this.outputPath = outputPath;
    }
  }
}
