import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.common.BitmovinException;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.AudioAdaptationSet;
import com.bitmovin.api.sdk.model.AudioConfiguration;
import com.bitmovin.api.sdk.model.AudioMediaInfo;
import com.bitmovin.api.sdk.model.CodecConfigType;
import com.bitmovin.api.sdk.model.CodecConfiguration;
import com.bitmovin.api.sdk.model.DashFmp4Representation;
import com.bitmovin.api.sdk.model.DashManifest;
import com.bitmovin.api.sdk.model.DashRepresentationType;
import com.bitmovin.api.sdk.model.DolbyVisionInputStream;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H265DynamicRangeFormat;
import com.bitmovin.api.sdk.model.H265VideoConfiguration;
import com.bitmovin.api.sdk.model.HlsManifest;
import com.bitmovin.api.sdk.model.HlsVersion;
import com.bitmovin.api.sdk.model.HttpsInput;
import com.bitmovin.api.sdk.model.IngestInputStream;
import com.bitmovin.api.sdk.model.Input;
import com.bitmovin.api.sdk.model.InputStream;
import com.bitmovin.api.sdk.model.MessageType;
import com.bitmovin.api.sdk.model.Muxing;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Output;
import com.bitmovin.api.sdk.model.Period;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.ProfileH265;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.StartEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInfo;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.Task;
import com.bitmovin.api.sdk.model.VideoAdaptationSet;
import com.bitmovin.api.sdk.model.VideoConfiguration;
import common.ConfigProvider;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * This example demonstrates how to convert dynamic range format between DolbyVision, HDR10, HLG and
 * SDR. The supported HDR/SDR conversions are following. If targeting output format is either
 * DolbyVision, HDR10 or HLG, this example adds SDR renditions automatically. This example works
 * only with Bitmovin Encoder version 2.98.0 or later. - Input: DolbyVision - Output: - DolbyVision
 * and SDR - HDR10 and SDR - Input: HDR10 - Output: - HDR10 and SDR - HLG and SDR - Input: HLG -
 * Output: - HLG and SDR - HDR10 and SDR - Input: SDR - Output: - HDR10 and SDR - HLG and SDR
 *
 * <p>This example assumes that the audio is stored in a separate file from the video.
 *
 * <p>The following configuration parameters are expected:
 *
 * <ul>
 *   <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
 *       the encoding.
 *   <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
 *       e.g.: my-storage.biz
 *   <li>HTTP_INPUT_FILE_PATH - The path to your input file.
 *   <li>HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH - The path to your DolbyVision metadata file.
 *       This parameter is required only when using DolbyVision input file with a separated sidecar
 *       XML metadata file.
 *   <li>HTTP_INPUT_AUDIO_FILE_PATH - The path to your audio file in case you want to load audio
 *       stream from a separate input file. If HTTP_INPUT_FILE_PATH has audio track too, you can
 *       specify the same path in this parameter.
 *   <li>HDR_CONVERSION_INPUT_FORMAT - The input HDR format. Either DolbyVision, HDR10, HLG, or SDR
 *       can be specified. This parameter needs to be matched with the actual HDR format of the
 *       input file.
 *   <li>HDR_CONVERSION_OUTPUT_FORMAT - The output HDR format to be converted from input file.
 *       Either DolbyVision, HDR10, HLG, or SDR can be specified.
 *   <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
 *   <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
 *   <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
 *   <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
 * </ul>
 */
public class HdrConversions {

    private static final Logger logger = LoggerFactory.getLogger(HdrConversions.class);

    private static BitmovinApi bitmovinApi;
    private static ConfigProvider configProvider;
    private static String INPUT_FORMAT;
    private static String OUTPUT_FORMAT;
    private static String EXAMPLE_NAME;

    public static void main(String[] args) throws Exception {
        configProvider = new ConfigProvider(args);
        INPUT_FORMAT = configProvider.getHdrConversionInputFormat();
        OUTPUT_FORMAT = configProvider.getHdrConversionOutputFormat();
        EXAMPLE_NAME = String.format("%s_To_%s", INPUT_FORMAT, OUTPUT_FORMAT);

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
                        EXAMPLE_NAME,
                        String.format(
                                "Encoding with HDR conversion from %s to %s", INPUT_FORMAT, OUTPUT_FORMAT));

        HttpsInput httpsInput = createHttpsInput(configProvider.getHttpInputHost());
        Output output =
                createS3Output(
                        configProvider.getS3OutputBucketName(),
                        configProvider.getS3OutputAccessKey(),
                        configProvider.getS3OutputSecretKey());

        String videoInputPath = configProvider.getHttpInputFilePath();
        String audioInputPath = configProvider.getHttpInputAudioFilePath();
        String inputMetadataPath;
        InputStream videoInputStream;

        if (StringUtils.equals(INPUT_FORMAT, "DolbyVision")) {
            inputMetadataPath = configProvider.getHttpInputDolbyVisionMetadataFilePath();
            videoInputStream =
                    createDolbyVisionInputStream(encoding, httpsInput, videoInputPath, inputMetadataPath);
        } else {
            videoInputStream =
                    createIngestInputStream(
                            encoding, httpsInput, videoInputPath, StreamSelectionMode.AUTO, 0);
        }

        InputStream audioInputStream =
                createIngestInputStream(encoding, httpsInput, audioInputPath, StreamSelectionMode.AUTO, 0);
        createH265AndAacEncoding(encoding, videoInputStream, audioInputStream, output);

        executeEncoding(encoding);

        DashManifest dashManifest = createDashManifest(encoding, output, "/");
        executeDashManifest(dashManifest);

        HlsManifest hlsManifest = createHlsManifest(encoding, output, "/");
        executeHlsManifest(hlsManifest);
    }

    /** Helper classes representing the encapsulation of the rendition */
    private static class Rendition {
        private final int height;
        private final int bitrate;
        private final ProfileH265 profileH265;
        private final H265DynamicRangeFormat dynamicRangeFormat;

        private Rendition(
                int height,
                int bitrate,
                ProfileH265 profileH265,
                H265DynamicRangeFormat dynamicRangeFormat) {
            this.height = height;
            this.bitrate = bitrate;
            this.profileH265 = profileH265;
            this.dynamicRangeFormat = dynamicRangeFormat;
        }
    }

    private static class RenditionDefition {
        private boolean needsSdrConversion;
        private ProfileH265 profileH265;
        private H265DynamicRangeFormat dynamicRangeFormat;
        private List<Rendition> renditions = new ArrayList<Rendition>();

        public RenditionDefition() throws Exception {
            needsSdrConversion = true;
            profileH265 = ProfileH265.MAIN10;

            switch (INPUT_FORMAT) {
                case "DolbyVision":
                {
                    if (StringUtils.equals(OUTPUT_FORMAT, "DolbyVision")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.DOLBY_VISION;
                    } else if (StringUtils.equals(OUTPUT_FORMAT, "HDR10")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
                    } else {
                        throw new Exception(
                                String.format("The dynamic range format %s is not supported", OUTPUT_FORMAT));
                    }
                    break;
                }
                case "HDR10":
                {
                    if (StringUtils.equals(OUTPUT_FORMAT, "HDR10")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
                    } else if (StringUtils.equals(OUTPUT_FORMAT, "HLG")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HLG;
                    } else {
                        throw new Exception(
                                String.format("The dynamic range format %s is not supported", OUTPUT_FORMAT));
                    }
                    break;
                }
                case "HLG":
                {
                    if (StringUtils.equals(OUTPUT_FORMAT, "HLG")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HLG;
                    } else if (StringUtils.equals(OUTPUT_FORMAT, "HDR10")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
                    } else {
                        throw new Exception(
                                String.format("The dynamic range format %s is not supported", OUTPUT_FORMAT));
                    }
                    break;
                }
                case "SDR":
                {
                    if (StringUtils.equals(OUTPUT_FORMAT, "HDR10")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HDR10;
                    } else if (StringUtils.equals(OUTPUT_FORMAT, "HLG")) {
                        dynamicRangeFormat = H265DynamicRangeFormat.HLG;
                    } else if (StringUtils.equals(OUTPUT_FORMAT, "SDR")) {
                        profileH265 = ProfileH265.MAIN;
                        dynamicRangeFormat = H265DynamicRangeFormat.SDR;
                        needsSdrConversion = false;
                    } else {
                        throw new Exception(
                                String.format("The dynamic range format %s is not supported", OUTPUT_FORMAT));
                    }
                    break;
                }
                default: throw new Exception(String.format("The input format %s is not supported", INPUT_FORMAT));
            }

            renditions.add(new Rendition(360, 160000, profileH265, dynamicRangeFormat));
            renditions.add(new Rendition(540, 730000, profileH265, dynamicRangeFormat));
            renditions.add(new Rendition(720, 2900000, profileH265, dynamicRangeFormat));
            renditions.add(new Rendition(1080, 5400000, profileH265, dynamicRangeFormat));
            renditions.add(new Rendition(1440, 9700000, profileH265, dynamicRangeFormat));
            renditions.add(new Rendition(2160, 13900000, profileH265, dynamicRangeFormat));

            if (needsSdrConversion) {
                renditions.add(new Rendition(360, 145000, ProfileH265.MAIN, H265DynamicRangeFormat.SDR));
                renditions.add(new Rendition(540, 600000, ProfileH265.MAIN, H265DynamicRangeFormat.SDR));
                renditions.add(new Rendition(720, 2400000, ProfileH265.MAIN, H265DynamicRangeFormat.SDR));
                renditions.add(new Rendition(1080, 4500000, ProfileH265.MAIN, H265DynamicRangeFormat.SDR));
            }
        }

        public List<Rendition> getRenditions() {
            return renditions;
        }

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
     * Creates an encoding with H265 codec/fMP4 muxing and AAC codec/fMP4 muxing
     *
     * @param encoding The encoding to be started
     * @param videoInputStream The video input to be used for the encoding
     * @param audioInputStream The audio input to be used for the encoding
     * @param output the output that should be used
     */
    private static void createH265AndAacEncoding(
            Encoding encoding, InputStream videoInputStream, InputStream audioInputStream, Output output)
            throws Exception {
        RenditionDefition renditionDefition = new RenditionDefition();
        String streamName;
        Stream videoStream;
        String outputPath;

        for (Rendition rendition : renditionDefition.getRenditions()) {
            VideoConfiguration videoConfiguration =
                    createH265VideoConfig(
                            rendition.height,
                            rendition.bitrate,
                            rendition.profileH265,
                            rendition.dynamicRangeFormat);

            if (rendition.dynamicRangeFormat.equals(H265DynamicRangeFormat.DOLBY_VISION)
                    || rendition.dynamicRangeFormat.equals(H265DynamicRangeFormat.HDR10)
                    || rendition.dynamicRangeFormat.equals(H265DynamicRangeFormat.HLG)) {
                streamName = String.format("h265 HDR stream %dp", rendition.height);
                outputPath =
                        String.format(
                                "video/hdr/%dp_%dkbps/",
                                videoConfiguration.getHeight(), Math.round(videoConfiguration.getBitrate() / 1000d));
            } else {
                streamName = String.format("h265 SDR stream %dp", rendition.height);
                outputPath =
                        String.format(
                                "video/sdr/%dp_%dkbps/",
                                videoConfiguration.getHeight(), Math.round(videoConfiguration.getBitrate() / 1000d));
            }
            videoStream = createStream(streamName, encoding, videoInputStream, videoConfiguration);

            createFmp4Muxing(encoding, output, outputPath, videoStream);
        }
        AudioConfiguration aacConfig = createAacAudioConfig();

        Stream aacAudioStream =
                createStream(
                        String.format(
                                "AAC stream %dkbps", Math.round(aacConfig.getBitrate() / 1000d)),
                        encoding,
                        audioInputStream,
                        aacConfig);

        createFmp4Muxing(
                encoding,
                output,
                String.format("audio/%dkbps/", Math.round(aacConfig.getBitrate() / 1000d)),
                aacAudioStream);
    }

    /**
     * Adds a video or audio stream to an encoding
     *
     * <p>API endpoint:
     * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
     *
     * @param name: A name that will help you identify the stream in our dashboard
     * @param encoding: The encoding to which the stream will be added
     * @param inputStream: The input stream resource providing the input video or audio
     * @param codecConfiguration: The codec configuration to be applied to the stream
     */
    private static Stream createStream(
            String name,
            Encoding encoding,
            InputStream inputStream,
            CodecConfiguration codecConfiguration) {
        StreamInput streamInput = new StreamInput();
        streamInput.setInputStreamId(inputStream.getId());

        Stream stream = new Stream();
        stream.setName(name);
        stream.addInputStreamsItem(streamInput);
        stream.setCodecConfigId(codecConfiguration.getId());

        return bitmovinApi.encoding.encodings.streams.create(encoding.getId(), stream);
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
     * Creates a resource representing an HTTPS server providing the input files. For alternative
     * input methods see <a
     * href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list of
     * supported input and output storages</a>
     *
     * <p>For reasons of simplicity, a new input resource is created on each execution of this
     * example. In production use, this method should be replaced by a <a
     * href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpsByInputId">get
     * call</a> to retrieve an existing resource.
     *
     * <p>API endpoint:
     * https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttps
     *
     * @param host The hostname or IP address of the HTTPS server e.g.: my-storage.biz
     */
    private static HttpsInput createHttpsInput(String host) throws BitmovinException {
        HttpsInput input = new HttpsInput();
        input.setHost(host);

        return bitmovinApi.encoding.inputs.https.create(input);
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
    private static IngestInputStream createIngestInputStream(
            Encoding encoding,
            Input input,
            String inputPath,
            StreamSelectionMode streamSelectionMode,
            int position)
            throws BitmovinException {
        IngestInputStream ingestInputStream = new IngestInputStream();
        ingestInputStream.setInputId(input.getId());
        ingestInputStream.setInputPath(inputPath);
        ingestInputStream.setSelectionMode(streamSelectionMode);
        ingestInputStream.setPosition(position);

        return bitmovinApi.encoding.encodings.inputStreams.ingest.create(
                encoding.getId(), ingestInputStream);
    }

    /**
     * Creates a DolbyVisionInputStream and adds it to an encoding.
     *
     * <p>API endpoints:
     * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsDolbyVisionByEncodingId
     *
     * <p>The DolbyVisionInputStream is used to define where a file to read a dolby vision stream from
     * is located.
     *
     * @param encoding The encoding to be started
     * @param input The input resource providing the input file
     * @param dolbyVisionInputPath The path to the DolbyVision input file
     * @param dolbyVisionMetadataPath The path to the DolbyVision XML metadata file if a sidecar XML
     *     is used. For embedded metadata case, it should be None.
     */
    private static DolbyVisionInputStream createDolbyVisionInputStream(
            Encoding encoding, Input input, String dolbyVisionInputPath, String dolbyVisionMetadataPath)
            throws BitmovinException {
        DolbyVisionInputStream dolbyVisionInputStream = new DolbyVisionInputStream();
        dolbyVisionInputStream.setInputId(input.getId());
        dolbyVisionInputStream.setVideoInputPath(dolbyVisionInputPath);
        dolbyVisionInputStream.setMetadataInputPath(dolbyVisionMetadataPath);

        return bitmovinApi.encoding.encodings.inputStreams.dolbyVision.create(
                encoding.getId(), dolbyVisionInputStream);
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
     * Creates a base H.265 video configuration. The width of the video will be set accordingly to the
     * aspect ratio of the source video.
     *
     * <p>The output resolution is defined by setting the height. Width will be determined
     * automatically to maintain the aspect ratio of your input video.
     *
     * <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
     * proven settings for the codec. See <a
     * href="https://bitmovin.com/docs/encoding/tutorials/h265-presets">for more detail of how the
     * preset configuration is converted to each codec parameter.
     *
     * <p>API endpoint:
     * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
     *
     * @param height The height of the output video
     * @param bitrate The target bitrate of the output video
     * @param profile The target H.265 profile (MAIN or MAIN10) of the output video
     * @param dynamicRangeFormat The target dynamic range format of the output video
     */
    private static H265VideoConfiguration createH265VideoConfig(
            int height, long bitrate, ProfileH265 profile, H265DynamicRangeFormat dynamicRangeFormat) {
        H265VideoConfiguration config = new H265VideoConfiguration();
        config.setName("H.265 video config " + height + "p");
        config.setHeight(height);
        config.setBitrate(bitrate);
        config.setProfile(profile);
        config.setDynamicRangeFormat(dynamicRangeFormat);
        config.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);

        return bitmovinApi.encoding.configurations.video.h265.create(config);
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
        String className = PerTitleEncoding.class.getSimpleName();
        return Paths.get(configProvider.getS3OutputBasePath(), className, relativePath).toString();
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
    private static DashManifest createDashManifest(
            Encoding encoding, Output output, String outputPath) {
        DashManifest dashManifest = new DashManifest();
        dashManifest.setManifestName("stream.mpd");
        dashManifest.addOutputsItem(buildEncodingOutput(output, outputPath));
        dashManifest.setName("DASH Manifest");

        dashManifest = bitmovinApi.encoding.manifests.dash.create(dashManifest);

        Period period = new Period();
        period = bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.getId(), period);

        VideoAdaptationSet videoAdaptationSetHdr = new VideoAdaptationSet();
        videoAdaptationSetHdr =
                bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
                        dashManifest.getId(), period.getId(), videoAdaptationSetHdr);

        VideoAdaptationSet videoAdaptationSetSdr = new VideoAdaptationSet();
        videoAdaptationSetSdr =
                bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
                        dashManifest.getId(), period.getId(), videoAdaptationSetSdr);

        AudioAdaptationSet audioAdaptationSet = new AudioAdaptationSet();
        audioAdaptationSet.setLang("en");

        audioAdaptationSet =
                bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
                        dashManifest.getId(), period.getId(), audioAdaptationSet);

        List<Fmp4Muxing> muxings =
                bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.getId()).getItems();

        for(Muxing fmp4Muxing: muxings) {

            Stream stream =
                    bitmovinApi.encoding.encodings.streams.get(
                            encoding.getId(), fmp4Muxing.getStreams().get(0).getStreamId());
            String segmentPath = removeOutputBasePath(fmp4Muxing.getOutputs().get(0).getOutputPath());
            CodecConfigType codecConfigurationType =
                    bitmovinApi.encoding.configurations.type.get(stream.getCodecConfigId()).getType();

            DashFmp4Representation dashFmp4Representation = new DashFmp4Representation();
            dashFmp4Representation.setType(DashRepresentationType.TEMPLATE);
            dashFmp4Representation.setEncodingId(encoding.getId());
            dashFmp4Representation.setMuxingId(fmp4Muxing.getId());
            dashFmp4Representation.setSegmentPath(segmentPath);

            if (codecConfigurationType == CodecConfigType.H265) {
                H265VideoConfiguration codecConfiguration =
                        bitmovinApi.encoding.configurations.video.h265.get(stream.getCodecConfigId());

                if (codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.DOLBY_VISION
                        || codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.HDR10
                        || codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.HLG) {

                    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4
                            .create(
                                    dashManifest.getId(),
                                    period.getId(),
                                    videoAdaptationSetHdr.getId(),
                                    dashFmp4Representation);
                } else {
                    if (codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.SDR) {

                        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4
                                .create(
                                        dashManifest.getId(),
                                        period.getId(),
                                        videoAdaptationSetSdr.getId(),
                                        dashFmp4Representation);
                    }
                }
            } else if (codecConfigurationType == CodecConfigType.AAC) {
                bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                        dashManifest.getId(),
                        period.getId(),
                        audioAdaptationSet.getId(),
                        dashFmp4Representation);
            }
        }

        return dashManifest;
    }

    /**
     * Creates a HLS manifest that includes all representations configured in the encoding.
     *
     * <p>API endpoint:
     * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
     *
     * @param encoding The encoding for which the manifest should be generated
     * @param output The output to which the manifest should be written
     * @param outputPath The path to which the manifest should be written
     * @return HlsManifest
     */
    private static HlsManifest createHlsManifest(
            Encoding encoding, Output output, String outputPath) {
        HlsManifest hlsManifest = new HlsManifest();

        hlsManifest.setManifestName("stream.m3u8");
        hlsManifest.addOutputsItem(buildEncodingOutput(output, outputPath));
        hlsManifest.setName("HLS Manifest");
        hlsManifest.setHlsMasterPlaylistVersion(HlsVersion.HLS_V8);
        hlsManifest.setHlsMediaPlaylistVersion(HlsVersion.HLS_V8);

        List<Fmp4Muxing> muxings =
                bitmovinApi.encoding.encodings.muxings.fmp4.list(encoding.getId()).getItems();
        hlsManifest = bitmovinApi.encoding.manifests.hls.create(hlsManifest);

        for(Muxing fmp4Muxing: muxings) {

            Stream stream =
                    bitmovinApi.encoding.encodings.streams.get(
                            encoding.getId(), fmp4Muxing.getStreams().get(0).getStreamId());
            CodecConfigType codecConfigurationType =
                    bitmovinApi.encoding.configurations.type.get(stream.getCodecConfigId()).getType();
            String segmentPath = removeOutputBasePath(fmp4Muxing.getOutputs().get(0).getOutputPath());

            if (codecConfigurationType.equals(CodecConfigType.H265)) {
                H265VideoConfiguration codecConfiguration =
                        bitmovinApi.encoding.configurations.video.h265.get(stream.getCodecConfigId());
                String url = String.format("stream_sdr_%d.m3u8", codecConfiguration.getBitrate());
                if (codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.DOLBY_VISION
                        || codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.HDR10
                        || codecConfiguration.getDynamicRangeFormat() == H265DynamicRangeFormat.HLG) {
                    url = String.format("stream_hdr_%d.m3u8", codecConfiguration.getBitrate());
                }
                StreamInfo streamInfo = new StreamInfo();
                streamInfo.setAudio("AUDIO");
                streamInfo.setClosedCaptions("NONE");
                streamInfo.setSegmentPath("");
                streamInfo.setUri(segmentPath + url);
                streamInfo.setMuxingId(fmp4Muxing.getId());
                streamInfo.setForceFrameRateAttribute(true);
                streamInfo.setForceVideoRangeAttribute(true);
                streamInfo.setStreamId(stream.getId());
                streamInfo.setEncodingId(encoding.getId());

                bitmovinApi.encoding.manifests.hls.streams.create(hlsManifest.getId(), streamInfo);
            } else if (codecConfigurationType == CodecConfigType.AAC) {
                AacAudioConfiguration codecConfiguration =
                        bitmovinApi.encoding.configurations.audio.aac.get(stream.getCodecConfigId());

                String url = String.format("aac_%d.m3u8", codecConfiguration.getBitrate());
                AudioMediaInfo audioMediaInfo = new AudioMediaInfo();
                audioMediaInfo.setName("HLS Audio Media");
                audioMediaInfo.setGroupId("AUDIO");
                audioMediaInfo.setSegmentPath("");
                audioMediaInfo.setEncodingId(encoding.getId());
                audioMediaInfo.setMuxingId(fmp4Muxing.getId());
                audioMediaInfo.setLanguage("en");
                audioMediaInfo.setStreamId(stream.getId());
                audioMediaInfo.setUri(segmentPath + url);

                bitmovinApi.encoding.manifests.hls.media.audio.create(
                        hlsManifest.getId(), audioMediaInfo);
            }
        }
        return hlsManifest;
    }

    /**
     * Create a relative path from an absolute path by removing S3_OUTPUT_BASE_PATH and EXAMPLE_NAME.
     *
     * <p>e.g.: input '/s3/base/path/exampleName/relative/path' output 'relative/path'
     *
     * @param absolutePath The relative path that is concatenated
     * @return
     */
    private static String removeOutputBasePath(String absolutePath) {
        if (absolutePath.startsWith(configProvider.getS3OutputBasePath() + EXAMPLE_NAME))
            return absolutePath.substring(
                    0, (configProvider.getS3OutputBasePath() + EXAMPLE_NAME).length());
        return absolutePath;
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
    private static void executeEncoding(Encoding encoding)
            throws InterruptedException, BitmovinException {
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
    }

    private static void logTaskErrors(Task task) {
        task.getMessages().stream()
                .filter(msg -> msg.getType() == MessageType.ERROR)
                .forEach(msg -> logger.error(msg.getText()));
    }
}
