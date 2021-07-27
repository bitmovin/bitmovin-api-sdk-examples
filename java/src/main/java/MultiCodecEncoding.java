import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.AudioAdaptationSet;
import com.bitmovin.api.sdk.model.AudioMediaInfo;
import com.bitmovin.api.sdk.model.CmafMuxing;
import com.bitmovin.api.sdk.model.CodecConfiguration;
import com.bitmovin.api.sdk.model.DashCmafRepresentation;
import com.bitmovin.api.sdk.model.DashFmp4Representation;
import com.bitmovin.api.sdk.model.DashManifest;
import com.bitmovin.api.sdk.model.DashProfile;
import com.bitmovin.api.sdk.model.DashRepresentationType;
import com.bitmovin.api.sdk.model.DashWebmRepresentation;
import com.bitmovin.api.sdk.model.DolbyDigitalAudioConfiguration;
import com.bitmovin.api.sdk.model.DolbyDigitalChannelLayout;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H264VideoConfiguration;
import com.bitmovin.api.sdk.model.H265VideoConfiguration;
import com.bitmovin.api.sdk.model.HlsManifest;
import com.bitmovin.api.sdk.model.HttpInput;
import com.bitmovin.api.sdk.model.MessageType;
import com.bitmovin.api.sdk.model.Muxing;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.Period;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.StartEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInfo;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import com.bitmovin.api.sdk.model.TsMuxing;
import com.bitmovin.api.sdk.model.VideoAdaptationSet;
import com.bitmovin.api.sdk.model.VorbisAudioConfiguration;
import com.bitmovin.api.sdk.model.Vp9VideoConfiguration;
import com.bitmovin.api.sdk.model.WebmMuxing;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This example showcases how to run a multi-codec workflow with the Bitmovin API following the best
 * practices. It is currently recommended to run one encoding job per codec to achieve optimal
 * performance and execution stability. After the encodings have been performed, renditions from
 * multiple encodings can be muxed together to build the desired manifest.
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
public class MultiCodecEncoding {
  private static final Logger logger = LoggerFactory.getLogger(MultiCodecEncoding.class);
  private static final String DATE_STRING =
      new SimpleDateFormat("yyyy-MM-dd-HH-mm-ss-SSS").format(new Date());

  private static final String HLS_AUDIO_GROUP_AAC_FMP4 = "audio-aac-fmp4";
  private static final String HLS_AUDIO_GROUP_AAC_TS = "audio-aac-ts";
  private static final String HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4 = "audio-dolby-digital-fmp4";

  private static BitmovinApi bitmovinApi;
  private static ConfigProvider configProvider;

  // Helper classes for manifest generation
  private static class Rendition {
    public int height;
    public Long bitrate;

    public Rendition(int height, Long bitrate) {
      this.height = height;
      this.bitrate = bitrate;
    }
  }

  private static class H264AndAacEncodingTracking {
    final Encoding encoding;

    List<Rendition> renditions;
    Map<Rendition, Stream> h264VideoStreams;
    Map<Rendition, CmafMuxing> h264CmafMuxings;
    Map<Rendition, TsMuxing> h264TsMuxings;

    Stream aacAudioStream;
    Fmp4Muxing aacFmp4Muxing;
    TsMuxing aacTsMuxing;

    static final String H264_TS_SEGMENTS_PATH_FORMAT = "video/h264/ts/%dp_%d";
    static final String H264_CMAF_SEGMENTS_PATH_FORMAT = "video/h264/cmaf/%dp_%d";
    static final String AAC_FMP4_SEGMENTS_PATH = "audio/aac/fmp4";
    static final String AAC_TS_SEGMENTS_PATH = "audio/aac/ts";

    public H264AndAacEncodingTracking(Encoding encoding) {
      this.encoding = encoding;
      h264VideoStreams = new HashMap<>();
      h264CmafMuxings = new HashMap<>();
      h264TsMuxings = new HashMap<>();

      renditions =
          Arrays.asList(
              new Rendition(234, 145_000L),
              new Rendition(360, 365_000L),
              new Rendition(432, 730_000L),
              new Rendition(540, 2_000_000L),
              new Rendition(720, 3_000_000L));
    }
  }

  private static class H265AndDolbyDigitalEncodingTracking {
    final Encoding encoding;

    List<Rendition> renditions;
    Map<Rendition, Stream> h265VideoStreams;
    Map<Rendition, Fmp4Muxing> h265Fmp4Muxings;

    Stream dolbyDigitalAudioStream;
    Fmp4Muxing dolbyDigitalFmp4Muxing;

    static final String H265_FMP4_SEGMENTS_PATH_FORMAT = "video/h265/fmp4/%dp_%d";
    static final String DOLBY_DIGITAL_FMP4_SEGMENTS_PATH = "audio/dolby-digital/fmp4";

    public H265AndDolbyDigitalEncodingTracking(Encoding encoding) {
      this.encoding = encoding;
      h265VideoStreams = new HashMap<>();
      h265Fmp4Muxings = new HashMap<>();

      renditions =
          Arrays.asList(
              new Rendition(540, 600_000L),
              new Rendition(720, 2_400_000L),
              new Rendition(1080, 4_500_000L),
              new Rendition(2160, 11_600_000L));
    }
  }

  private static class Vp9AndVorbisEncodingTracking {
    final Encoding encoding;

    List<Rendition> renditions;

    Map<Rendition, WebmMuxing> vp9WebmMuxing;
    WebmMuxing vorbisWebmMuxing;

    static final String VP9_WEBM_SEGMENTS_PATH_FORMAT = "video/vp9/webm/%dp_%d";
    static final String VORBIS_WEBM_SEGMENTS_PATH = "audio/vorbis/webm";

    public Vp9AndVorbisEncodingTracking(Encoding encoding) {
      this.encoding = encoding;

      vp9WebmMuxing = new HashMap<>();

      renditions =
          Arrays.asList(
              new Rendition(540, 600_000L),
              new Rendition(720, 2_400_000L),
              new Rendition(1080, 4_500_000L),
              new Rendition(2160, 11_600_000L));
    }
  }

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

    HttpInput input = createHttpInput(configProvider.getHttpInputHost());
    Output output =
        createS3Output(
            configProvider.getS3OutputBucketName(),
            configProvider.getS3OutputAccessKey(),
            configProvider.getS3OutputSecretKey());

    String inputFilePath = configProvider.getHttpInputFilePath();

    H264AndAacEncodingTracking h264AndAacEncodingTracking =
        createH264AndAacEncoding(input, inputFilePath, output);
    H265AndDolbyDigitalEncodingTracking h265AndDolbyDigitalEncodingTracking =
        createH265AndDolbyDigitalEncoding(input, inputFilePath, output);
    Vp9AndVorbisEncodingTracking vp9AndVorbisEncodingTracking =
        createVp9AndVorbisEncoding(input, inputFilePath, output);

    ExecutorService executor = Executors.newFixedThreadPool(3);

    List<Callable<Encoding>> encodingTasks =
        Arrays.asList(
            () -> executeEncoding(h264AndAacEncodingTracking.encoding),
            () -> executeEncoding(h265AndDolbyDigitalEncodingTracking.encoding),
            () -> executeEncoding(vp9AndVorbisEncodingTracking.encoding));

    executor.invokeAll(encodingTasks);

    executor.shutdown();

    DashManifest dashManifest =
        createDashManifest(
            output,
            h264AndAacEncodingTracking,
            h265AndDolbyDigitalEncodingTracking,
            vp9AndVorbisEncodingTracking);
    executeDashManifest(dashManifest);

    HlsManifest hlsManifest =
        createHlsManifest(output, h264AndAacEncodingTracking, h265AndDolbyDigitalEncodingTracking);
    executeHlsManifest(hlsManifest);
  }

  /**
   * Creates the encoding with H264 codec/Ts muxing, H264 codec/CMAF muxing, AAC codec/fMP4 muxing
   *
   * @param input the input that should be used
   * @param inputFilePath the path to the input file
   * @param output the output that should be used
   * @return the tracking information for the encoding
   */
  private static H264AndAacEncodingTracking createH264AndAacEncoding(
      HttpInput input, String inputFilePath, Output output) {

    Encoding encoding =
        createEncoding(
            "H.264 Encoding",
            "H.264 -> TS muxing, H.264 -> CMAF muxing, AAC -> fMP4 muxing, AAC -> TS muxing");

    H264AndAacEncodingTracking encodingTracking = new H264AndAacEncodingTracking(encoding);

    for (Rendition rendition : encodingTracking.renditions) {
      H264VideoConfiguration videoConfiguration =
          createH264VideoConfig(rendition.height, rendition.bitrate);

      Stream videoStream = createStream(encoding, input, inputFilePath, videoConfiguration);

      String cmafMuxingOutputPath =
          String.format(
              H264AndAacEncodingTracking.H264_CMAF_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate);

      String tsMuxingOutputPath =
          String.format(
              H264AndAacEncodingTracking.H264_TS_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate);

      CmafMuxing cmafMuxing = createCmafMuxing(encoding, output, cmafMuxingOutputPath, videoStream);
      TsMuxing tsMuxing = createTsMuxing(encoding, output, tsMuxingOutputPath, videoStream);

      encodingTracking.h264VideoStreams.put(rendition, videoStream);
      encodingTracking.h264CmafMuxings.put(rendition, cmafMuxing);
      encodingTracking.h264TsMuxings.put(rendition, tsMuxing);
    }

    // Add an AAC audio stream to the encoding
    AacAudioConfiguration aacConfig = createAacAudioConfig();
    Stream aacAudioStream = createStream(encoding, input, inputFilePath, aacConfig);
    encodingTracking.aacAudioStream = aacAudioStream;

    // Create a fMP4 muxing and a TS muxing with the AAC stream
    encodingTracking.aacFmp4Muxing =
        createFmp4Muxing(
            encoding, output, H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH, aacAudioStream);

    encodingTracking.aacTsMuxing =
        createTsMuxing(
            encoding, output, H264AndAacEncodingTracking.AAC_TS_SEGMENTS_PATH, aacAudioStream);

    return encodingTracking;
  }

  /**
   * Creates the encoding with H265 codec/fMP4 muxing, Dolby Digital codec/fMP4 muxing
   *
   * @param input the input that should be used
   * @param inputFilePath the path to the input file
   * @param output the output that should be used
   * @return the tracking information for the encoding
   */
  private static H265AndDolbyDigitalEncodingTracking createH265AndDolbyDigitalEncoding(
      HttpInput input, String inputFilePath, Output output) {

    Encoding encoding =
        createEncoding("H.265 Encoding", "H.265 -> fMP4 muxing, Dolby Digital -> fMP4 muxing");
    H265AndDolbyDigitalEncodingTracking encodingTracking =
        new H265AndDolbyDigitalEncodingTracking(encoding);

    // Add streams and muxings for h265 encoding
    for (Rendition rendition : encodingTracking.renditions) {
      H265VideoConfiguration videoConfiguration =
          createH265VideoConfig(rendition.height, rendition.bitrate);
      Stream videoStream = createStream(encoding, input, inputFilePath, videoConfiguration);
      Fmp4Muxing fmp4Muxing =
          createFmp4Muxing(
              encoding,
              output,
              String.format(
                  H265AndDolbyDigitalEncodingTracking.H265_FMP4_SEGMENTS_PATH_FORMAT,
                  rendition.height,
                  rendition.bitrate),
              videoStream);

      encodingTracking.h265VideoStreams.put(rendition, videoStream);
      encodingTracking.h265Fmp4Muxings.put(rendition, fmp4Muxing);
    }

    DolbyDigitalAudioConfiguration dolbyDigitalConfig = createDolbyDigitalAudioConfig();
    encodingTracking.dolbyDigitalAudioStream =
        createStream(encoding, input, inputFilePath, dolbyDigitalConfig);

    // Create a fMP4 muxing with the Dolby Digital stream
    encodingTracking.dolbyDigitalFmp4Muxing =
        createFmp4Muxing(
            encoding,
            output,
            H265AndDolbyDigitalEncodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
            encodingTracking.dolbyDigitalAudioStream);

    return encodingTracking;
  }

  /**
   * Created the encoding with VP9 codec/WebM muxing, Vorbis codec / WebM muxing
   *
   * @param input the input that should be used
   * @param inputFilePath the path to the input file
   * @param output the output that should be used
   * @return the tracking information for the encoding
   */
  private static Vp9AndVorbisEncodingTracking createVp9AndVorbisEncoding(
      HttpInput input, String inputFilePath, Output output) {
    Encoding encoding =
        createEncoding("VP9/Vorbis Encoding", "VP9 -> WebM muxing, Vorbis -> WebM muxing");

    Vp9AndVorbisEncodingTracking encodingTracking = new Vp9AndVorbisEncodingTracking(encoding);

    // Create video streams and add webm muxings to the VP9 encoding
    for (Rendition rendition : encodingTracking.renditions) {
      Vp9VideoConfiguration vp9Config =
          createVp9VideoConfiguration(rendition.height, rendition.bitrate);
      Stream vp9VideoStream = createStream(encoding, input, inputFilePath, vp9Config);

      encodingTracking.vp9WebmMuxing.put(
          rendition,
          createWebmMuxing(
              encoding,
              output,
              String.format(
                  Vp9AndVorbisEncodingTracking.VP9_WEBM_SEGMENTS_PATH_FORMAT,
                  rendition.height,
                  rendition.bitrate),
              vp9VideoStream));
    }

    // Create Vorbis audio configuration
    VorbisAudioConfiguration vorbisAudioConfiguration = createVorbisAudioConfiguration();
    Stream vorbisAudioStream =
        createStream(encoding, input, inputFilePath, vorbisAudioConfiguration);

    // Create a WebM muxing with the Vorbis audio stream
    encodingTracking.vorbisWebmMuxing =
        createWebmMuxing(
            encoding,
            output,
            Vp9AndVorbisEncodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
            vorbisAudioStream);

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
  private static DashManifest createDashManifest(
      Output output,
      H264AndAacEncodingTracking h264AndAacEncodingTracking,
      H265AndDolbyDigitalEncodingTracking h265AndDolbyDigitalEncodingTracking,
      Vp9AndVorbisEncodingTracking vp9AndVorbisEncodingTracking) {
    DashManifest dashManifest = createDashManifest("stream.mpd", DashProfile.LIVE, output, "/");

    final Period period =
        bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.getId(), new Period());

    final VideoAdaptationSet videoAdaptationSetVp9 =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
            dashManifest.getId(), period.getId(), new VideoAdaptationSet());

    final VideoAdaptationSet videoAdaptationSetH265 =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
            dashManifest.getId(), period.getId(), new VideoAdaptationSet());

    final VideoAdaptationSet videoAdaptationSetH264 =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
            dashManifest.getId(), period.getId(), new VideoAdaptationSet());

    AudioAdaptationSet vorbisAudioAdaptationSet =
        createAudioAdaptionSet(dashManifest, period, "en");
    AudioAdaptationSet ddAudioAdaptationSet = createAudioAdaptionSet(dashManifest, period, "en");
    AudioAdaptationSet aacAudioAdaptationSet = createAudioAdaptionSet(dashManifest, period, "en");

    // Add representations to VP9 adaptation set
    // Add VP9 WEBM muxing to VP9 adaptation set
    for (Rendition rendition : vp9AndVorbisEncodingTracking.vp9WebmMuxing.keySet()) {
      createDashWebmRepresentation(
          vp9AndVorbisEncodingTracking.encoding,
          vp9AndVorbisEncodingTracking.vp9WebmMuxing.get(rendition),
          dashManifest,
          period,
          String.format(
              Vp9AndVorbisEncodingTracking.VP9_WEBM_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate),
          videoAdaptationSetVp9.getId());
    }

    // Add VORBIS WEBM muxing to VORBIS audio adaptation set
    createDashWebmRepresentation(
        vp9AndVorbisEncodingTracking.encoding,
        vp9AndVorbisEncodingTracking.vorbisWebmMuxing,
        dashManifest,
        period,
        Vp9AndVorbisEncodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
        vorbisAudioAdaptationSet.getId());

    // Add representations to H265 adaptation set
    // Add H265 FMP4 muxing to H265 video adaptation set
    for (Rendition rendition : h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings.keySet()) {
      createDashFmp4Representation(
          h265AndDolbyDigitalEncodingTracking.encoding,
          h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings.get(rendition),
          dashManifest,
          period,
          String.format(
              H265AndDolbyDigitalEncodingTracking.H265_FMP4_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate),
          videoAdaptationSetH265.getId());
    }

    // Add Dolby Digital FMP4 muxing to Dolby Digital audio adaptation set
    createDashFmp4Representation(
        h265AndDolbyDigitalEncodingTracking.encoding,
        h265AndDolbyDigitalEncodingTracking.dolbyDigitalFmp4Muxing,
        dashManifest,
        period,
        H265AndDolbyDigitalEncodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
        ddAudioAdaptationSet.getId());

    // Add representations to H264 adaptation set
    // Add H264 CMAF muxing to H264 video adaptation set
    for (Rendition rendition : h264AndAacEncodingTracking.h264CmafMuxings.keySet()) {
      createDashCmafRepresentation(
          h264AndAacEncodingTracking.encoding,
          h264AndAacEncodingTracking.h264CmafMuxings.get(rendition),
          dashManifest,
          period,
          String.format(
              H264AndAacEncodingTracking.H264_CMAF_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate),
          videoAdaptationSetH264.getId());
    }

    // Add AAC FMP4 muxing to AAC audio adaptation set
    createDashFmp4Representation(
        h264AndAacEncodingTracking.encoding,
        h264AndAacEncodingTracking.aacFmp4Muxing,
        dashManifest,
        period,
        H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
        aacAudioAdaptationSet.getId());

    return dashManifest;
  }

  /**
   * Creates the HLS manifest master playlist with the different sub playlists
   *
   * @param output the output that should be used
   * @param h264AndAacEncodingTracking the tracking information for the H264/AAC encoding
   * @param h265AndDolbyDigitalEncodingTracking the tracking information for the H265 encoding
   * @return the created HLS manifest
   */
  private static HlsManifest createHlsManifest(
      Output output,
      H264AndAacEncodingTracking h264AndAacEncodingTracking,
      H265AndDolbyDigitalEncodingTracking h265AndDolbyDigitalEncodingTracking) {
    HlsManifest hlsManifest = createHlsMasterManifest("master.m3u8", output, "/");

    // Create h265 audio playlists
    createAudioMediaPlaylist(
        h265AndDolbyDigitalEncodingTracking.encoding,
        hlsManifest,
        h265AndDolbyDigitalEncodingTracking.dolbyDigitalFmp4Muxing,
        h265AndDolbyDigitalEncodingTracking.dolbyDigitalAudioStream,
        "audio_dolby_digital_fmp4.m3u8",
        H265AndDolbyDigitalEncodingTracking.DOLBY_DIGITAL_FMP4_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4);

    // Create h265 video playlists
    for (Rendition rendition : h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings.keySet()) {
      createVideoStreamPlaylist(
          h265AndDolbyDigitalEncodingTracking.encoding,
          hlsManifest,
          h265AndDolbyDigitalEncodingTracking.h265Fmp4Muxings.get(rendition),
          h265AndDolbyDigitalEncodingTracking.h265VideoStreams.get(rendition),
          String.format("video_h265_%dp_%d.m3u8", rendition.height, rendition.bitrate),
          String.format(
              H265AndDolbyDigitalEncodingTracking.H265_FMP4_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate),
          HLS_AUDIO_GROUP_DOLBY_DIGITAL_FMP4);
    }

    // Create h264 audio playlists
    createAudioMediaPlaylist(
        h264AndAacEncodingTracking.encoding,
        hlsManifest,
        h264AndAacEncodingTracking.aacFmp4Muxing,
        h264AndAacEncodingTracking.aacAudioStream,
        "audio_aac_fmp4.m3u8",
        H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_AAC_FMP4);

    createAudioMediaPlaylist(
        h264AndAacEncodingTracking.encoding,
        hlsManifest,
        h264AndAacEncodingTracking.aacTsMuxing,
        h264AndAacEncodingTracking.aacAudioStream,
        "audio_aac_ts.m3u8",
        H264AndAacEncodingTracking.AAC_TS_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_AAC_TS);

    // Create h264 video playlists
    for (Rendition rendition : h264AndAacEncodingTracking.h264TsMuxings.keySet()) {
      createVideoStreamPlaylist(
          h264AndAacEncodingTracking.encoding,
          hlsManifest,
          h264AndAacEncodingTracking.h264TsMuxings.get(rendition),
          h264AndAacEncodingTracking.h264VideoStreams.get(rendition),
          String.format("video_h264_%dp_%d.m3u8", rendition.height, rendition.bitrate),
          String.format(
              H264AndAacEncodingTracking.H264_TS_SEGMENTS_PATH_FORMAT,
              rendition.height,
              rendition.bitrate),
          HLS_AUDIO_GROUP_AAC_TS);
    }

    return hlsManifest;
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
  private static HttpInput createHttpInput(String host) {
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
  private static S3Output createS3Output(String bucketName, String accessKey, String secretKey) {

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
  private static Encoding createEncoding(String name, String description) {
    Encoding encoding = new Encoding();
    encoding.setName(name);
    encoding.setDescription(description);

    return bitmovinApi.encoding.encodings.create(encoding);
  }

  /**
   * Creates a stream which binds an input file to a codec configuration. The stream is used for
   * muxings later on.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
   *
   * @param encoding The encoding to add the stream onto
   * @param input The input that should be used
   * @param inputPath The path to the input file
   * @param codecConfiguration The codec configuration to be applied to the stream
   */
  private static Stream createStream(
      Encoding encoding, HttpInput input, String inputPath, CodecConfiguration codecConfiguration) {
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
  private static H264VideoConfiguration createH264VideoConfig(int height, long bitrate) {
    H264VideoConfiguration config = new H264VideoConfiguration();
    config.setName("H.264 video config " + height + "p");
    config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
    config.setHeight(height);
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.video.h264.create(config);
  }

  /**
   * Creates a base H.265 video configuration. The width of the video will be set accordingly to the
   * aspect ratio of the source video.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
   */
  private static H265VideoConfiguration createH265VideoConfig(int height, long bitrate) {
    H265VideoConfiguration config = new H265VideoConfiguration();
    config.setName("H.265 video config " + height + "p");
    config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
    config.setHeight(height);
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.video.h265.create(config);
  }

  /**
   * Creates a base VP9 video configuration. The width of the video will be set accordingly to the
   * aspect ratio of the source video.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoVp9
   */
  private static Vp9VideoConfiguration createVp9VideoConfiguration(int height, long bitrate) {
    Vp9VideoConfiguration config = new Vp9VideoConfiguration();
    config.setName("VP9 video configuration " + height + "p");
    config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
    config.setHeight(height);
    config.setBitrate(bitrate);

    return bitmovinApi.encoding.configurations.video.vp9.create(config);
  }

  /**
   * Creates a configuration for the AAC audio codec to be applied to audio streams.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
   */
  private static AacAudioConfiguration createAacAudioConfig() {
    AacAudioConfiguration config = new AacAudioConfiguration();
    config.setName("AAC 128 kbit/s");
    config.setBitrate(128_000L);

    return bitmovinApi.encoding.configurations.audio.aac.create(config);
  }

  /**
   * Creates a Vorbis audio configuration. The sample rate of the audio will be set accordingly to
   * the sample rate of the source audio.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioVorbis
   */
  private static VorbisAudioConfiguration createVorbisAudioConfiguration() {
    VorbisAudioConfiguration config = new VorbisAudioConfiguration();
    config.setName("Vorbis 128 kbit/s");
    config.setBitrate(128_000L);

    return bitmovinApi.encoding.configurations.audio.vorbis.create(config);
  }

  /**
   * Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
   * adaptive streaming.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
   *
   * @param encoding The encoding to add the muxing to
   * @param output The output that should be used for the muxing to write the segments to
   * @param outputPath The output path where the fragmented segments will be written to
   * @param stream The stream that is associated with the muxing
   */
  private static Fmp4Muxing createFmp4Muxing(
      Encoding encoding, Output output, String outputPath, Stream stream) {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    Fmp4Muxing muxing = new Fmp4Muxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);
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
  private static CmafMuxing createCmafMuxing(
      Encoding encoding, Output output, String outputPath, Stream stream) {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    CmafMuxing muxing = new CmafMuxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.cmaf.create(encoding.getId(), muxing);
  }

  /**
   * Creates a WebM muxing. This will generate segments with a given segment length for adaptive
   * streaming.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsWebmByEncodingId
   *
   * @param encoding The encoding to add the muxing to
   * @param output The output that should be used for the muxing to write the segments to
   * @param outputPath The output path where the fragmented segments will be written to
   * @param stream The stream that is associated with the muxing
   */
  private static WebmMuxing createWebmMuxing(
      Encoding encoding, Output output, String outputPath, Stream stream) {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    WebmMuxing muxing = new WebmMuxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.webm.create(encoding.getId(), muxing);
  }

  /**
   * Creates a fragmented TS muxing. This will generate segments with a given segment length for
   * adaptive streaming.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
   *
   * @param encoding The encoding where to add the muxing to
   * @param output The output that should be used for the muxing to write the segments to
   * @param outputPath The output path where the segments will be written to
   * @param stream The stream that is associated with the muxing
   */
  private static TsMuxing createTsMuxing(
      Encoding encoding, Output output, String outputPath, Stream stream) {
    MuxingStream muxingStream = new MuxingStream();
    muxingStream.setStreamId(stream.getId());

    TsMuxing muxing = new TsMuxing();
    muxing.addOutputsItem(buildEncodingOutput(output, outputPath));
    muxing.addStreamsItem(muxingStream);
    muxing.setSegmentLength(4.0);

    return bitmovinApi.encoding.encodings.muxings.ts.create(encoding.getId(), muxing);
  }

  /**
   * Creates a Dolby Digital audio configuration.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioDD
   */
  private static DolbyDigitalAudioConfiguration createDolbyDigitalAudioConfig() {
    DolbyDigitalAudioConfiguration config = new DolbyDigitalAudioConfiguration();
    config.setName("DolbyDigital Channel Layout 5.1");
    config.setBitrate(256_000L);
    config.setChannelLayout(DolbyDigitalChannelLayout.CL_5_1);

    return bitmovinApi.encoding.configurations.audio.dolbyDigital.create(config);
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
    String className = MultiCodecEncoding.class.getSimpleName();
    return Paths.get(
            configProvider.getS3OutputBasePath(),
            String.format("%s-%s", className, DATE_STRING),
            relativePath)
        .toString();
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
  private static Encoding executeEncoding(Encoding encoding) throws InterruptedException {
    bitmovinApi.encoding.encodings.start(encoding.getId(), new StartEncodingRequest());

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
    return encoding;
  }

  /** Creates the HLS master manifest. */
  private static HlsManifest createHlsMasterManifest(
      String name, Output output, String outputPath) {
    HlsManifest hlsManifest = new HlsManifest();
    hlsManifest.setName(name);
    hlsManifest.addOutputsItem(buildEncodingOutput(output, outputPath));

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
  private static void createAudioMediaPlaylist(
      Encoding encoding,
      HlsManifest manifest,
      Muxing audioMuxing,
      Stream audioStream,
      String uri,
      String audioSegmentsPath,
      String audioGroup) {
    AudioMediaInfo audioMediaInfo = new AudioMediaInfo();
    audioMediaInfo.setName(uri);
    audioMediaInfo.setUri(uri);
    audioMediaInfo.setGroupId(audioGroup);
    audioMediaInfo.setEncodingId(encoding.getId());
    audioMediaInfo.setStreamId(audioStream.getId());
    audioMediaInfo.setMuxingId(audioMuxing.getId());
    audioMediaInfo.setLanguage("en");
    audioMediaInfo.setAssocLanguage("en");
    audioMediaInfo.setAutoselect(false);
    audioMediaInfo.setIsDefault(false);
    audioMediaInfo.setForced(false);
    audioMediaInfo.setSegmentPath(audioSegmentsPath);

    bitmovinApi.encoding.manifests.hls.media.audio.create(manifest.getId(), audioMediaInfo);
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
  private static void createVideoStreamPlaylist(
      Encoding encoding,
      HlsManifest manifest,
      Muxing videoMuxing,
      Stream videoStream,
      String uri,
      String segmentPath,
      String audioGroup) {
    StreamInfo streamInfo = new StreamInfo();
    streamInfo.setUri(uri);
    streamInfo.setEncodingId(encoding.getId());
    streamInfo.setStreamId(videoStream.getId());
    streamInfo.setMuxingId(videoMuxing.getId());
    streamInfo.setAudio(audioGroup);
    streamInfo.setSegmentPath(segmentPath);

    bitmovinApi.encoding.manifests.hls.streams.create(manifest.getId(), streamInfo);
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
  private static DashManifest createDashManifest(
      String name, DashProfile dashProfile, Output output, String outputPath) {
    DashManifest dashManifest = new DashManifest();
    dashManifest.setName(name);
    dashManifest.setProfile(dashProfile);
    dashManifest.addOutputsItem(buildEncodingOutput(output, outputPath));

    return bitmovinApi.encoding.manifests.dash.create(dashManifest);
  }

  /**
   * Creates a DASH representation.
   *
   * <p>API endpoint:
   * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
   *
   * @param muxing the respective audio muxing
   * @param period the DASH period
   */
  private static void createDashFmp4Representation(
      Encoding encoding,
      Fmp4Muxing muxing,
      DashManifest dashManifest,
      Period period,
      String fmp4H264SegmentPath,
      String id) {
    DashFmp4Representation dashFmp4H264Representation = new DashFmp4Representation();
    dashFmp4H264Representation.setType(DashRepresentationType.TEMPLATE);
    dashFmp4H264Representation.setEncodingId(encoding.getId());
    dashFmp4H264Representation.setMuxingId(muxing.getId());
    dashFmp4H264Representation.setSegmentPath(fmp4H264SegmentPath);

    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
        dashManifest.getId(), period.getId(), id, dashFmp4H264Representation);
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
  private static void createDashCmafRepresentation(
      Encoding encoding,
      CmafMuxing muxing,
      DashManifest dashManifest,
      Period period,
      String segmentPath,
      String adaptationSetId) {
    DashCmafRepresentation dashCmafRepresentation = new DashCmafRepresentation();
    dashCmafRepresentation.setType(DashRepresentationType.TEMPLATE);
    dashCmafRepresentation.setEncodingId(encoding.getId());
    dashCmafRepresentation.setMuxingId(muxing.getId());
    dashCmafRepresentation.setSegmentPath(segmentPath);

    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.cmaf.create(
        dashManifest.getId(), period.getId(), adaptationSetId, dashCmafRepresentation);
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
  private static void createDashWebmRepresentation(
      Encoding encoding,
      WebmMuxing muxing,
      DashManifest dashManifest,
      Period period,
      String segmentPath,
      String adaptationSetId) {
    DashWebmRepresentation dashWebmRepresentation = new DashWebmRepresentation();
    dashWebmRepresentation.setType(DashRepresentationType.TEMPLATE);
    dashWebmRepresentation.setEncodingId(encoding.getId());
    dashWebmRepresentation.setMuxingId(muxing.getId());
    dashWebmRepresentation.setSegmentPath(segmentPath);

    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.webm.create(
        dashManifest.getId(), period.getId(), adaptationSetId, dashWebmRepresentation);
  }

  /** Creates an audio adaption set for the dash manifest */
  private static AudioAdaptationSet createAudioAdaptionSet(
      DashManifest dashManifest, Period period, String language) {
    AudioAdaptationSet audioAdaptationSet = new AudioAdaptationSet();
    audioAdaptationSet.setLang(language);

    return bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
        dashManifest.getId(), period.getId(), audioAdaptationSet);
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
  private static void executeDashManifest(DashManifest dashManifest) throws InterruptedException {
    bitmovinApi.encoding.manifests.dash.start(dashManifest.getId());

    Status statusResponse;
    do {
      Thread.sleep(500);
      statusResponse = bitmovinApi.encoding.manifests.dash.status(dashManifest.getId()).getStatus();
    } while (statusResponse != Status.FINISHED && statusResponse != Status.ERROR);

    if (statusResponse == Status.ERROR) {
      throw new RuntimeException("Dash manifest failed");
    }
    logger.info("Dash manifest finished successfully");
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
  private static void executeHlsManifest(HlsManifest hlsManifest) throws InterruptedException {
    bitmovinApi.encoding.manifests.hls.start(hlsManifest.getId());

    Status statusResponse;
    do {
      Thread.sleep(500);
      statusResponse = bitmovinApi.encoding.manifests.hls.status(hlsManifest.getId()).getStatus();
    } while (statusResponse != Status.FINISHED && statusResponse != Status.ERROR);

    if (statusResponse == Status.ERROR) {
      throw new RuntimeException("Hls manifest failed");
    }
    logger.info("Hls manifest finished successfully");
  }

  private static void logTaskErrors(Task task) {
    task.getMessages().stream()
        .filter(msg -> msg.getType() == MessageType.ERROR)
        .forEach(msg -> logger.error(msg.getText()));
  }
}
