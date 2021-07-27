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
import com.bitmovin.api.sdk.model.HttpInput;
import com.bitmovin.api.sdk.model.Input;
import com.bitmovin.api.sdk.model.Manifest;
import com.bitmovin.api.sdk.model.ManifestGenerator;
import com.bitmovin.api.sdk.model.ManifestResource;
import com.bitmovin.api.sdk.model.MessageType;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.StartEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamMode;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This example demonstrates how to create default DASH and HLS manifests for an encoding.
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
public class DefaultManifests {

  private static final Logger logger = LoggerFactory.getLogger(DefaultManifests.class);

  private static BitmovinApi bitmovinApi;
  private static ConfigProvider configProvider;

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
            "Encoding with default manifests", "Encoding with HLS and DASH default manifests");

    Input input = createHttpInput(configProvider.getHttpInputHost());
    Output output =
        createS3Output(
            configProvider.getS3OutputBucketName(),
            configProvider.getS3OutputAccessKey(),
            configProvider.getS3OutputSecretKey());

    // Add a template video stream to the encoding
    H264VideoConfiguration h264Config = createH264VideoConfig();
    Stream videoStream =
        createStream(encoding, input, configProvider.getHttpInputFilePath(), h264Config);
    createFmp4Muxing(encoding, output, "video", videoStream);

    // Add audio stream to the encoding
    AacAudioConfiguration aacConfig = createAacAudioConfig();
    Stream audioStream =
        createStream(encoding, input, configProvider.getHttpInputFilePath(), aacConfig);
    createFmp4Muxing(encoding, output, "audio", audioStream);

    DashManifest dashManifest = createDefaultDashManifest(encoding, output, "/");
    HlsManifest hlsManifest = createDefaultHlsManifest(encoding, output, "/");

    StartEncodingRequest startEncodingRequest = new StartEncodingRequest();
    startEncodingRequest.setManifestGenerator(ManifestGenerator.V2);
    startEncodingRequest.addVodDashManifestsItem(buildManifestResource(dashManifest));
    startEncodingRequest.addVodHlsManifestsItem(buildManifestResource(hlsManifest));

    executeEncoding(encoding, startEncodingRequest);
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
   * Create a stream which binds an input file to a codec configuration. The stream is used later
   * for muxings.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
   *
   * @param encoding The encoding where to add the stream to
   * @param input The input where the input file is located
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
    stream.setMode(StreamMode.STANDARD);

    return bitmovinApi.encoding.encodings.streams.create(encoding.getId(), stream);
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
  private static H264VideoConfiguration createH264VideoConfig() throws BitmovinException {
    H264VideoConfiguration config = new H264VideoConfiguration();
    config.setName("H.264 1080p 1.5 Mbit/s");
    config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
    config.setHeight(1080);
    config.setBitrate(1_500_000L);

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
  private static Fmp4Muxing createFmp4Muxing(
      Encoding encoding, Output output, String outputPath, Stream stream) throws BitmovinException {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    Fmp4Muxing muxing = new Fmp4Muxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);
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
    String className = DefaultManifests.class.getSimpleName();
    return Paths.get(configProvider.getS3OutputBasePath(), className, relativePath).toString();
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
  private static void executeEncoding(Encoding encoding, StartEncodingRequest startEncodingRequest)
      throws InterruptedException, BitmovinException {
    bitmovinApi.encoding.encodings.start(encoding.getId(), startEncodingRequest);

    Task task;
    do {
      Thread.sleep(5000);
      task = bitmovinApi.encoding.encodings.status(encoding.getId());
      logger.info("Encoding status is {} (progress: {} %)", task.getStatus(), task.getProgress());
    } while (task.getStatus() != Status.FINISHED
        && task.getStatus() != Status.ERROR
        && task.getStatus() != Status.CANCELED);

    if (task.getStatus() == Status.ERROR) {
      logTaskErrors(task);
      throw new RuntimeException("Encoding failed");
    }
    logger.info("Encoding finished successfully");
  }

  /**
   * Creates a DASH default manifest that automatically includes all representations configured in
   * the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashDefault
   *
   * @param encoding The encoding for which the manifest should be generated
   * @param output The output to which the manifest should be written
   * @param outputPath The path to which the manifest should be written
   */
  private static DashManifest createDefaultDashManifest(
      Encoding encoding, Output output, String outputPath) {
    DashManifestDefault dashManifestDefault = new DashManifestDefault();
    dashManifestDefault.setEncodingId(encoding.getId());
    dashManifestDefault.setManifestName("stream.mpd");
    dashManifestDefault.setVersion(DashManifestDefaultVersion.V1);
    dashManifestDefault.addOutputsItem(buildEncodingOutput(output, outputPath));
    return bitmovinApi.encoding.manifests.dash.defaultapi.create(dashManifestDefault);
  }

  /**
   * Creates an HLS default manifest that automatically includes all representations configured in
   * the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
   *
   * @param encoding The encoding for which the manifest should be generated
   * @param output The output to which the manifest should be written
   * @param outputPath The path to which the manifest should be written
   */
  private static HlsManifest createDefaultHlsManifest(
      Encoding encoding, Output output, String outputPath) {
    HlsManifestDefault hlsManifestDefault = new HlsManifestDefault();
    hlsManifestDefault.setEncodingId(encoding.getId());
    hlsManifestDefault.addOutputsItem(buildEncodingOutput(output, outputPath));
    hlsManifestDefault.setName("master.m3u8");
    hlsManifestDefault.setVersion(HlsManifestDefaultVersion.V1);

    return bitmovinApi.encoding.manifests.hls.defaultapi.create(hlsManifestDefault);
  }

  /**
   * Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
   * StartEncodingRequest manifest lists.
   *
   * @param manifest The manifest to be generated at the end of the encoding process
   */
  private static ManifestResource buildManifestResource(Manifest manifest) {
    ManifestResource manifestResource = new ManifestResource();
    manifestResource.setManifestId(manifest.getId());
    return manifestResource;
  }

  private static void logTaskErrors(Task task) {
    task.getMessages().stream()
        .filter(msg -> msg.getType() == MessageType.ERROR)
        .forEach(msg -> logger.error(msg.getText()));
  }
}
