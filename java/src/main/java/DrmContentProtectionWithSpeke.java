import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.common.BitmovinException;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.AudioAdaptationSet;
import com.bitmovin.api.sdk.model.AudioMediaInfo;
import com.bitmovin.api.sdk.model.CodecConfigType;
import com.bitmovin.api.sdk.model.CodecConfiguration;
import com.bitmovin.api.sdk.model.ContentProtection;
import com.bitmovin.api.sdk.model.DashFmp4Representation;
import com.bitmovin.api.sdk.model.DashManifest;
import com.bitmovin.api.sdk.model.DashRepresentationType;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H264VideoConfiguration;
import com.bitmovin.api.sdk.model.HlsManifest;
import com.bitmovin.api.sdk.model.HttpInput;
import com.bitmovin.api.sdk.model.Input;
import com.bitmovin.api.sdk.model.ManifestGenerator;
import com.bitmovin.api.sdk.model.ManifestResource;
import com.bitmovin.api.sdk.model.MessageType;
import com.bitmovin.api.sdk.model.Muxing;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.Period;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.SpekeDrm;
import com.bitmovin.api.sdk.model.SpekeDrmProvider;
import com.bitmovin.api.sdk.model.StartEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInfo;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamMode;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import com.bitmovin.api.sdk.model.VideoAdaptationSet;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This example shows how DRM content protection can be applied to a fragmented MP4 muxing.
 * Acquisition of DRM keys is done by using the SPEKE protocol, and is configured to offer
 * compatibility with both PlayReady and Widevine on the one hand, using the MPEG-CENC
 * standard, and with Fairplay on the other hand. Separate outputs are created for both types
 * of encryption, due to them having different encryption mode. Separate manifests are also created
 * (DASH for CENC and HLS for FairPlay)
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
 *   <li>DRM_CONTENT_ID - (optional) The content ID that identifies your content within the SPEKE provider
 *   <li>DRM_KEY_ID - (optional) An additional 16-byte hex key ID that could be needed for some use cases
 *   <li>DRM_FAIRPLAY_IV - The initialisation vector for the FairPlay encryption configuration
 *   <li>SPEKE_URL - The URL of the SPEKE server.
 *       Example: https://my-speke-server.com/v1.0/vod
 * </ul>
 *
 * In addition, you need the following parameters to access the SPEKE server:
 *
 * <ul>
 *   <li>For authentication with AWS IAM:
 *     <ul>
 *       <li>SPEKE_ARN  -  The role ARN allowing access to the SPEKE server</li>
 *       <li>SPEKE_GATEWAY_REGION  -  The region of the associated AWS Gateway</li>
 *     </ul>
 *   </li>
 *   <li>For basic authentication:
 *     <ul>
 *       <li>SPEKE_USERNAME  -  The username to access the SPEKE server</li>
 *       <li>SPEKE_PASSWORD  -  The password to access the SPEKE server</li>
 *     </ul>
 *   </li>
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
public class DrmContentProtectionWithSpeke {

  private static final Logger logger = LoggerFactory.getLogger(DrmContentProtectionWithSpeke.class);

  private static BitmovinApi bitmovinApi;
  private static ConfigProvider configProvider;

  private static final String WIDEVINE_SYSTEM_ID = "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
  private static final String PLAYREADY_SYSTEM_ID = "9a04f079-9840-4286-ab92-e65be0885f95";
  private static final String FAIRPLAY_SYSTEM_ID = "94ce86fb-07ff-4f43-adb8-93d2fa968ca2";

  public static void main(String[] args) throws Exception {
    configProvider = new ConfigProvider(args);
    bitmovinApi =
        BitmovinApi.builder()
            .withApiKey(configProvider.getBitmovinApiKey())
            // uncomment the following line if you are working with a multi-tenant account
            // .withTenantOrgId(configProvider.getBitmovinTenantOrgId())
            .withLogger(
                new Slf4jLogger(), Level.FULL) // set the logger and log level for the API client
            .build();

    Encoding encoding =
        createEncoding("SPEKE DRM protection on fMP4 muxings",
            "Example with CENC and Fairplay DRM content protection using SPEKE");

    HttpInput input = createHttpInput(configProvider.getHttpInputHost());
    Output output =
        createS3Output(
            configProvider.getS3OutputBucketName(),
            configProvider.getS3OutputAccessKey(),
            configProvider.getS3OutputSecretKey());

    H264VideoConfiguration h264Config = createH264VideoConfig();
    AacAudioConfiguration aacConfig = createAacAudioConfig();

    Stream videoStream =
        createStream(encoding, input, configProvider.getHttpInputFilePath(), h264Config);
    Stream audioStream =
        createStream(encoding, input, configProvider.getHttpInputFilePath(), aacConfig);

    Fmp4Muxing videoMuxing = createBaseFmp4Muxing(encoding, videoStream);
    Fmp4Muxing audioMuxing = createBaseFmp4Muxing(encoding, audioStream);

    createFmp4SpekeDrm(encoding, videoMuxing, output, "video/cenc",
        Arrays.asList(WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID));
    createFmp4SpekeDrm(encoding, audioMuxing, output, "audio/cenc",
        Arrays.asList(WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID));

    createFmp4SpekeDrm(encoding, videoMuxing, output, "video/fairplay",
        Collections.singletonList(FAIRPLAY_SYSTEM_ID));
    createFmp4SpekeDrm(encoding, audioMuxing, output, "audio/fairplay",
        Collections.singletonList(FAIRPLAY_SYSTEM_ID));

    DashManifest dashManifest = createDashManifest(encoding, output, "/");
    HlsManifest hlsManifest = createHlsManifest(encoding, output, "/");

    executeEncoding(encoding, dashManifest, hlsManifest);
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
  private static Encoding createEncoding(String name, String description) throws BitmovinException {
    Encoding encoding = new Encoding();
    encoding.setName(name);
    encoding.setDescription(description);

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
   * Creates a resource representing an AWS S3 cloud storage bucket to which generated content will
   * be transferred. For alternative output methods see <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list
   * of supported input and output storages</a>
   *
   * <p>The provided credentials need to allow <i>read</i>, <i>write</i> and <i>list</i>
   * operations.
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
   * Creates a resource representing an HTTP server providing the input files. For alternative input
   * methods see <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list
   * of supported input and output storages</a>
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
   * Creates a fragmented MP4 muxing. This will split the output into continuously numbered segments
   * of a given length for adaptive streaming. However, the unencrypted segments will not be written
   * to a permanent storage as there's no output defined for the muxing. Instead, an output needs to
   * be defined for the DRM configuration resource which will later be added to this muxing.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
   *
   * @param encoding The encoding to which the muxing will be added
   * @param stream The stream to be muxed
   */
  private static Fmp4Muxing createBaseFmp4Muxing(Encoding encoding, Stream stream)
      throws BitmovinException {
    Fmp4Muxing muxing = new Fmp4Muxing();
    muxing.setSegmentLength(4.0);

    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());
    muxing.addStreamsItem(muxingStream);

    return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);
  }

  /**
   * Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and PlayReady
   * specific fields will be included into DASH and HLS manifests to enable key retrieval using
   * either DRM method. Encryption information is acquired from a DRM server using the SPEKE protocol
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId
   *
   * @param encoding The encoding to which the muxing belongs to
   * @param muxing The muxing to apply the encryption to
   * @param output The output resource to which the encrypted segments will be written to
   * @param outputPath The output path where the encrypted segments will be written to
   * @param systemIds The list of DRM System IDs to encrypt with
   */
  private static SpekeDrm createFmp4SpekeDrm(
      Encoding encoding, Muxing muxing, Output output, String outputPath, List<String> systemIds) throws BitmovinException {

    SpekeDrmProvider provider = new SpekeDrmProvider();
    provider.setUrl(configProvider.getParameterByKey("SPEKE_URL"));

    if (configProvider.hasParameterByKey("SPEKE_ARN")) {
      provider.setRoleArn(configProvider.getParameterByKey("SPEKE_ARN"));
      provider.setGatewayRegion(configProvider.getParameterByKey("SPEKE_GATEWAY_REGION"));
    } else {
      provider.setUsername(configProvider.getParameterByKey("SPEKE_USERNAME"));
      provider.setPassword(configProvider.getParameterByKey("SPEKE_PASSWORD"));
    }

    SpekeDrm drm = new SpekeDrm();
    drm.setProvider(provider);
    drm.addOutputsItem(buildEncodingOutput(output, outputPath));
    drm.setSystemIds(systemIds);

    if (configProvider.hasParameterByKey("DRM_CONTENT_ID")) {
      drm.setContentId(configProvider.getParameterByKey("DRM_CONTENT_ID"));
    }

    if (configProvider.hasParameterByKey("DRM_KEY_ID")) {
      drm.setKid(configProvider.getParameterByKey("DRM_KEY_ID"));
    }

    if (systemIds.contains(FAIRPLAY_SYSTEM_ID)) {
      drm.setIv(configProvider.getDrmFairplayIv());
    }

    return bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.create(
        encoding.getId(), muxing.getId(), drm);
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
    String className = DrmContentProtectionWithSpeke.class.getSimpleName();
    return Paths.get(configProvider.getS3OutputBasePath(), className, relativePath).toString();
  }

  /**
   * Creates a configuration for the H.264 video codec to be applied to video streams.
   *
   * <p>The output resolution is defined by setting the height to 1080 pixels. Width will be
   * determined automatically to maintain the aspect ratio of your input video.
   *
   * <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will
   * apply
   * proven settings for the codec. See <a href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
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
   * Starts the actual encoding process and periodically polls its status until it reaches a final
   * state
   *
   * <p>API endpoints:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
   *
   * <p>Please note that you can also use our webhooks API instead of polling the status. For more
   * information consult the API spec: https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
   *
   * @param encoding The encoding to be started
   */
  private static void executeEncoding(Encoding encoding, DashManifest dashManifest, HlsManifest hlsManifest)
      throws InterruptedException, BitmovinException {
    ManifestResource dashManifestResource = new ManifestResource();
    dashManifestResource.setManifestId(dashManifest.getId());

    ManifestResource hlsManifestResource = new ManifestResource();
    hlsManifestResource.setManifestId(hlsManifest.getId());

    StartEncodingRequest startEncodingRequest = new StartEncodingRequest();
    startEncodingRequest.setManifestGenerator(ManifestGenerator.V2);
    startEncodingRequest.addVodDashManifestsItem(dashManifestResource);
    startEncodingRequest.addVodHlsManifestsItem(hlsManifestResource);

    bitmovinApi.encoding.encodings.start(encoding.getId(), startEncodingRequest);

    Task task;
    do {
      Thread.sleep(5000);
      task = bitmovinApi.encoding.encodings.status(encoding.getId());
      logger.info("encoding status is {} (progress: {} %)", task.getStatus(), task.getProgress());
    } while (task.getStatus() != Status.FINISHED && task.getStatus() != Status.ERROR);

    if (task.getStatus() == Status.ERROR) {
      logTaskErrors(task);
      throw new RuntimeException("Encoding failed");
    }
    logger.info("encoding finished successfully");
  }

  /**
   * Creates a DASH manifest that includes all representations configured in the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
   *
   * @param encoding The encoding for which the manifest should be generated
   * @param output The output to which the manifest should be written
   * @param outputPath The path to which the manifest should be written
   */
  private static DashManifest createDashManifest(Encoding encoding, Output output, String outputPath)
      throws Exception {
    DashManifest dashManifest = new DashManifest();
    dashManifest.setName("DASH manifest with CENC DRM");
    dashManifest.setManifestName("stream.mpd");
    dashManifest.addOutputsItem(buildEncodingOutput(output, outputPath));
    dashManifest = bitmovinApi.encoding.manifests.dash.create(dashManifest);

    Period period = bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.getId(),
        new Period());

    VideoAdaptationSet videoAdaptationSet =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
            dashManifest.getId(), period.getId(), new VideoAdaptationSet());
    AudioAdaptationSet audioAdaptationSet =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
            dashManifest.getId(), period.getId(), new AudioAdaptationSet());

    List<Fmp4Muxing> fmp4Muxings = bitmovinApi.encoding.encodings.muxings.fmp4.list(
        encoding.getId()).getItems();

    for (Fmp4Muxing fmp4Muxing: fmp4Muxings) {
      List<SpekeDrm> spekeDrms = bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.list(
          encoding.getId(), fmp4Muxing.getId()).getItems();

      for (SpekeDrm spekeDrm: spekeDrms) {
          if (spekeDrm.getSystemIds().contains(WIDEVINE_SYSTEM_ID)) {

          Stream stream = bitmovinApi.encoding.encodings.streams.get(
              encoding.getId(), fmp4Muxing.getStreams().get(0).getStreamId());
          String segmentPath = removeOutputBasePath(spekeDrm.getOutputs().get(0).getOutputPath());

          DashFmp4Representation representation = new DashFmp4Representation();
          representation.setEncodingId(encoding.getId());
          representation.setMuxingId(fmp4Muxing.getId());
          representation.setSegmentPath(segmentPath);
          representation.setType(DashRepresentationType.TEMPLATE);

          ContentProtection contentProtection = new ContentProtection();
          contentProtection.setEncodingId(encoding.getId());
          contentProtection.setMuxingId(fmp4Muxing.getId());
          contentProtection.setDrmId(spekeDrm.getId());

          CodecConfigType codec = bitmovinApi.encoding.configurations.type.get(stream.getCodecConfigId()).getType();

          if (codec == CodecConfigType.H264) {
            bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                dashManifest.getId(), period.getId(), videoAdaptationSet.getId(), representation);
            bitmovinApi.encoding.manifests.dash.periods.adaptationsets.contentprotection.create(
                dashManifest.getId(), period.getId(), videoAdaptationSet.getId(), contentProtection);
          } else if (codec == CodecConfigType.AAC) {
            bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                dashManifest.getId(), period.getId(), audioAdaptationSet.getId(), representation);
            bitmovinApi.encoding.manifests.dash.periods.adaptationsets.contentprotection.create(
                dashManifest.getId(), period.getId(), audioAdaptationSet.getId(), contentProtection);
          }
        }
      }
    }

    return dashManifest;
  }

  /**
   * Creates an HLS manifest that includes all representations configured in the encoding.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
   *
   * @param encoding The encoding for which the manifest should be generated
   * @param output The output to which the manifest should be written
   * @param outputPath The path to which the manifest should be written
   */
  private static HlsManifest createHlsManifest(Encoding encoding, Output output, String outputPath)
      throws Exception {
    HlsManifest hlsManifest = new HlsManifest();
    hlsManifest.setName("HLS manifest with Fairplay DRM");
    hlsManifest.setManifestName("main.m3u8");
    hlsManifest.addOutputsItem(buildEncodingOutput(output, outputPath));
    hlsManifest = bitmovinApi.encoding.manifests.hls.create(hlsManifest);

    List<Fmp4Muxing> fmp4Muxings = bitmovinApi.encoding.encodings.muxings.fmp4.list(
        encoding.getId()).getItems();

    for (int i=0; i < fmp4Muxings.size(); i++) {
      Fmp4Muxing fmp4Muxing = fmp4Muxings.get(i);

      List<SpekeDrm> spekeDrms = bitmovinApi.encoding.encodings.muxings.fmp4.drm.speke.list(
          encoding.getId(), fmp4Muxing.getId()).getItems();

      for (SpekeDrm spekeDrm : spekeDrms) {
        if (spekeDrm.getSystemIds().contains(FAIRPLAY_SYSTEM_ID)) {

          Stream stream = bitmovinApi.encoding.encodings.streams.get(
              encoding.getId(), fmp4Muxing.getStreams().get(0).getStreamId());
          String segmentPath = removeOutputBasePath(spekeDrm.getOutputs().get(0).getOutputPath());

          CodecConfigType codec = bitmovinApi.encoding.configurations.type.get(stream.getCodecConfigId()).getType();

          if (codec == CodecConfigType.H264) {
            StreamInfo streamInfo = new StreamInfo();
            streamInfo.setEncodingId(encoding.getId());
            streamInfo.setMuxingId(fmp4Muxing.getId());
            streamInfo.setStreamId(stream.getId());
            streamInfo.setDrmId(spekeDrm.getId());
            streamInfo.setAudio("audio");
            streamInfo.setSegmentPath(segmentPath);
            streamInfo.setUri(String.format("video_%s.m3u8", i));
            bitmovinApi.encoding.manifests.hls.streams.create(hlsManifest.getId(), streamInfo);
          }

          if (codec == CodecConfigType.AAC) {
            AudioMediaInfo audioMediaInfo = new AudioMediaInfo();
            audioMediaInfo.setName("audio");
            audioMediaInfo.setEncodingId(encoding.getId());
            audioMediaInfo.setMuxingId(fmp4Muxing.getId());
            audioMediaInfo.setStreamId(stream.getId());
            audioMediaInfo.setDrmId(spekeDrm.getId());
            audioMediaInfo.setGroupId("audio");
            audioMediaInfo.setLanguage("en");
            audioMediaInfo.setSegmentPath(segmentPath);
            audioMediaInfo.setUri(String.format("audio_%s.m3u8", i));
            bitmovinApi.encoding.manifests.hls.media.audio.create(hlsManifest.getId(), audioMediaInfo);
          }
        }
      }
    }

    return hlsManifest;
  }

  /**
   * Creates a relative path from an absolute path, suitable for insertion into a manifest
   *
   * <p>e.g.: input '/s3/base/path/exampleName/relative/path' ->  output 'relative/path'</p>
   *
   * @param absolutePath - The path to convert into a relative one
   */
  private static String removeOutputBasePath(String absolutePath) {
    String basePath = buildAbsolutePath("/") + "/";
    if (absolutePath.startsWith(basePath)) {
      return absolutePath.replace(basePath, "");
    }
    return absolutePath;
  }

  private static void logTaskErrors(Task task) {
    task.getMessages().stream()
        .filter(msg -> msg.getType() == MessageType.ERROR)
        .forEach(msg -> logger.error(msg.getText()));
  }
}
