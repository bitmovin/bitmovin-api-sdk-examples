package common;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This class is responsible for retrieving config values from different sources in this order:
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
public class ConfigProvider {
  private static final Logger logger = LoggerFactory.getLogger(ConfigProvider.class);

  private final Map<String, Map<String, String>> configuration = new LinkedHashMap<>();

  /**
   * @param args commandline arguments to be parsed, these have highest priority over all other
   *     config sources
   */
  public ConfigProvider(String[] args) {
    // parse command line arguments
    configuration.put("Command line arguments", parseCliArguments(args));

    // parse properties from ./examples.properties
    configuration.put("Local properties file", parsePropertiesFile("."));

    // parse environment variables
    configuration.put("Environment variables", parseEnvironmentVariables());

    // parse properties from ~/.bitmovin/examples.properties
    configuration.put(
        "System-wide properties file",
        parsePropertiesFile(System.getProperty("user.home") + File.separator + ".bitmovin"));
  }

  public String getBitmovinApiKey() {
    return getOrThrowException("BITMOVIN_API_KEY", "Your API key for the Bitmovin API.");
  }

  public String getBitmovinTenantOrgId() {
    return getOrThrowException(
        "BITMOVIN_TENANT_ORG_ID",
        "The ID of the Organisation in which you want to perform the encoding.");
  }

  public String getHttpInputHost() {
    return getOrThrowException(
        "HTTP_INPUT_HOST",
        "Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz");
  }

  public String getHttpInputFilePath() {
    return getOrThrowException(
        "HTTP_INPUT_FILE_PATH",
        "The path to your Http input file. Example: videos/1080p_Sintel.mp4");
  }

  public String getHttpInputFilePathWithStereoSound() {
    return getOrThrowException(
        "HTTP_INPUT_FILE_PATH_STEREO_SOUND",
        "The path to a file containing a video with a single audio stereo stream. Example: videos/1080p_Sintel_Stereo.mp4");
  }

  public String getHttpInputFilePathWithSurroundSound() {
    return getOrThrowException(
        "HTTP_INPUT_FILE_PATH_SURROUND_SOUND",
        "The path and filename for a file containing a video with a 5.1 audio stream. Example: videos/1080p_Sintel_Surround.mp4");
  }

  public String getHttpInputFilePathWithMultipleMonoAudioTracks() {
    return getOrThrowException(
        "HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS",
        "The path to a file containing a video with multiple mono audio tracks. Example: videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4");
  }

  public String getHttpInputFilePathWithTwoStereoTracks() {
    return getOrThrowException(
        "HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS",
        "The path to a file containing a video with 2 stereo tracks. Example: videos/1080p_Sintel_Two_Stereos.mp4");
  }

  public String getHttpInputBumperFilePath() {
    return getOrThrowException(
            "HTTP_INPUT_BUMPER_FILE_PATH",
            "The path to your Http input file. Example: videos/bumper.mp4");
  }

  public String getHttpInputPromoFilePath() {
    return getOrThrowException(
            "HTTP_INPUT_PROMO_FILE_PATH",
            "The path to your Http input file. Example: videos/promo.mp4");
  }

  public String getHttpInputAudioFilePath() {
    return getOrThrowException(
            "HTTP_INPUT_AUDIO_FILE_PATH",
            "The path to your audio file in case you want to load audio stream from a separate input file."
                    + " If HTTP_INPUT_FILE_PATH has audio track too, you can specify the same path in this parameter."
                    + " Example: audio/big_buck_bunny_1080p_h264.mov");
  }

  public String getHttpInputDolbyVisionMetadataFilePath() {
    return getOrThrowException(
            "HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH",
            "The path to your Http Dolby Vision metadata input file. Example: netflix-opencontent/SolLevante/dolbyvision/sollevante_j2k_sidecar.xml");
  }

  public String getHdrConversionInputFormat() {
    return getOrThrowException(
            "HDR_CONVERSION_INPUT_FORMAT",
            "The input HDR format. Either DolbyVision, HDR10, HLG, or SDR can be specified."
                    + " This parameter needs to be matched with the actual HDR format of the input file."
                    + " Example: DolbyVision");
  }

  public String getHdrConversionOutputFormat() {
    return getOrThrowException(
            "HDR_CONVERSION_OUTPUT_FORMAT",
            "The output HDR format to be converted from input file."
                    + " Either DolbyVision, HDR10, HLG, or SDR can be specified. "
                    + " Example: HDR10");
  }

  public String getS3InputBucketName() {
    return getOrThrowException(
        "S3_INPUT_BUCKET_NAME", "The name of your S3 input bucket. Example: my-bucket-name");
  }

  public String getS3InputFilePath() {
    return getOrThrowException(
        "S3_INPUT_FILE_PATH", "The path to your S3 input file. Example: videos/1080p_Sintel.mp4");
  }

  public String getS3InputArnRole() {
    return getOrThrowException(
        "S3_INPUT_ARN_ROLE", "The ARN role of your S3 role based input bucket.");
  }

  public String getS3InputExternalId() {
    return getOrThrowException(
        "S3_INPUT_EXT_ID", "The external ID of your S3 role based input bucket.");
  }

  public String getS3OutputBucketName() {
    return getOrThrowException(
        "S3_OUTPUT_BUCKET_NAME", "The name of your S3 output bucket. Example: my-bucket-name");
  }

  public String getS3OutputAccessKey() {
    return getOrThrowException("S3_OUTPUT_ACCESS_KEY", "The access key of your S3 output bucket.");
  }

  public String getS3OutputSecretKey() {
    return getOrThrowException("S3_OUTPUT_SECRET_KEY", "The secret key of your S3 output bucket.");
  }

  public String getS3OutputArnRole() {
    return getOrThrowException(
        "S3_OUTPUT_ARN_ROLE", "The ARN role of your S3 role based output bucket.");
  }

  public String getS3OutputExternalId() {
    return getOrThrowException(
        "S3_OUTPUT_EXT_ID", "The external ID of your S3 role based output bucket.");
  }

  public String getS3OutputBasePath() {
    return StringUtils.appendIfMissing(
        StringUtils.removeStart(
            getOrThrowException(
                "S3_OUTPUT_BASE_PATH", "The base path on your S3 output bucket. Example: /outputs"),
            "/"),
        "/");
  }

  public String getWatermarkImagePath() {
    return getOrThrowException(
        "WATERMARK_IMAGE_PATH",
        "The path to the watermark image. Example: http://my-storage.biz/logo.png");
  }

  public String getTextFilterText() {
    return getOrThrowException("TEXT_FILTER_TEXT", "The text to be displayed by the text filter.");
  }

  public String getDrmKey() {
    return getOrThrowException(
        "DRM_KEY",
        "16 byte encryption key, represented as 32 hexadecimal characters Example: cab5b529ae28d5cc5e3e7bc3fd4a544d");
  }

  public String getDrmFairplayIv() {
    return getOrThrowException(
        "DRM_FAIRPLAY_IV",
        "16 byte initialization vector, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d");
  }

  public String getDrmFairplayUri() {
    return getOrThrowException(
        "DRM_FAIRPLAY_URI",
        "URI of the licensing server Example: skd://userspecifc?custom=information");
  }

  public String getDrmWidevineKid() {
    return getOrThrowException(
        "DRM_WIDEVINE_KID",
        "16 byte encryption key id, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d");
  }

  public String getDrmWidevinePssh() {
    return getOrThrowException(
        "DRM_WIDEVINE_PSSH", "Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg==");
  }

  /* This generic method will enable addition and use of new config settings in a simple way */
  public String getParameterByKey(String keyName) {
    return getOrThrowException(keyName, String.format("Configuration Parameter '%s'", keyName));
  }

  private String getOrThrowException(String key, String description) {
    for (String configurationName : configuration.keySet()) {
      Map<String, String> subConfiguration = this.configuration.get(configurationName);
      if (subConfiguration.containsKey(key)) {
        String value = subConfiguration.get(key);
        logger.info("Retrieved '{}' from '{}' config source: '{}'", key, configurationName, value);
        return value;
      }
    }

    throw new MissingArgumentException(key, description);
  }

  private Map<String, String> parsePropertiesFile(String propertiesFileDirectory) {
    File propertiesFile =
        new File(propertiesFileDirectory + File.separator + "examples.properties");

    try (FileReader reader = new FileReader(propertiesFile)) {
      Properties p = new Properties();
      p.load(reader);

      return p.stringPropertyNames().stream()
          .filter(key -> StringUtils.isNotEmpty(p.getProperty(key)))
          .collect(Collectors.toMap(key -> key, p::getProperty));
    } catch (FileNotFoundException e) {
      return new HashMap<>();
    } catch (IOException e) {
      throw new RuntimeException(
          "Error reading properties file: " + propertiesFile.getAbsolutePath(), e);
    }
  }

  private Map<String, String> parseCliArguments(String[] args) {
    return Arrays.stream(args)
        .map(x -> x.split("=", 2))
        .filter(x -> x.length == 2 && StringUtils.isNotEmpty(x[1]))
        .collect(Collectors.toMap(keyValue -> keyValue[0], keyValue -> keyValue[1]));
  }

  private Map<String, String> parseEnvironmentVariables() {
    return System.getenv();
  }

  private static class MissingArgumentException extends RuntimeException {
    MissingArgumentException(String argument, String description) {
      super(argument + " - " + description);
    }
  }
}
