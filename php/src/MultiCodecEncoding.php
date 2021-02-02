<?php

require './vendor/autoload.php';

require_once './common/ConfigProvider.php';

use BitmovinApiSdk\BitmovinApi;
use BitmovinApiSdk\Common\BitmovinApiException;
use BitmovinApiSdk\Common\Logging\ConsoleLogger;
use BitmovinApiSdk\Configuration;
use BitmovinApiSdk\Models\AacAudioConfiguration;
use BitmovinApiSdk\Models\Ac3AudioConfiguration;
use BitmovinApiSdk\Models\AclEntry;
use BitmovinApiSdk\Models\AclPermission;
use BitmovinApiSdk\Models\AudioAdaptationSet;
use BitmovinApiSdk\Models\AudioMediaInfo;
use BitmovinApiSdk\Models\CmafMuxing;
use BitmovinApiSdk\Models\CodecConfiguration;
use BitmovinApiSdk\Models\DashCmafRepresentation;
use BitmovinApiSdk\Models\DashFmp4Representation;
use BitmovinApiSdk\Models\DashManifest;
use BitmovinApiSdk\Models\DashProfile;
use BitmovinApiSdk\Models\DashRepresentationType;
use BitmovinApiSdk\Models\DashWebmRepresentation;
use BitmovinApiSdk\Models\Encoding;
use BitmovinApiSdk\Models\EncodingOutput;
use BitmovinApiSdk\Models\Fmp4Muxing;
use BitmovinApiSdk\Models\H264VideoConfiguration;
use BitmovinApiSdk\Models\H265VideoConfiguration;
use BitmovinApiSdk\Models\HlsManifest;
use BitmovinApiSdk\Models\HttpInput;
use BitmovinApiSdk\Models\Input;
use BitmovinApiSdk\Models\MessageType;
use BitmovinApiSdk\Models\Muxing;
use BitmovinApiSdk\Models\MuxingStream;
use BitmovinApiSdk\Models\Output;
use BitmovinApiSdk\Models\Period;
use BitmovinApiSdk\Models\PresetConfiguration;
use BitmovinApiSdk\Models\S3Output;
use BitmovinApiSdk\Models\Status;
use BitmovinApiSdk\Models\Stream;
use BitmovinApiSdk\Models\StreamInfo;
use BitmovinApiSdk\Models\StreamInput;
use BitmovinApiSdk\Models\Task;
use BitmovinApiSdk\Models\TsMuxing;
use BitmovinApiSdk\Models\VideoAdaptationSet;
use BitmovinApiSdk\Models\VorbisAudioConfiguration;
use BitmovinApiSdk\Models\Vp9VideoConfiguration;
use BitmovinApiSdk\Models\WebmMuxing;

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
 *   <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
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
 *   <li>properties file located in the root folder of the PHP examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */

$exampleName = 'MultiCodecEncoding';
$DATE_STRING = date("Y-m-d") . "T" . date("H:i:s");

const HLS_AUDIO_GROUP_AAC_FMP4 = "audio-aac-fmp4";
const HLS_AUDIO_GROUP_AAC_TS = "audio-aac-ts";
const HLS_AUDIO_GROUP_AC3_FMP4 = "audio-ac3-fmp4";

$configProvider = new ConfigProvider();

// Helper classes for manifest generation
class Rendition
{
    public $height;
    public $bitrate;

    public function __construct(int $height, int $bitrate)
    {
        $this->height = $height;
        $this->bitrate = $bitrate;
    }
}

class H264AndAacEncodingTracking
{
    public $encoding;

    public $renditions;
    public $h264VideoStreams;
    public $h264CmafMuxings;
    public $h264TsMuxings;

    public $aacAudioStream;
    public $aacFmp4Muxing;
    public $aacTsMuxing;

    public $H264_TS_SEGMENTS_PATH_FORMAT = "video/h264/ts/%dp_%d";
    public $H264_CMAF_SEGMENTS_PATH_FORMAT = "video/h264/cmaf/%dp_%d";
    public $AAC_FMP4_SEGMENTS_PATH = "audio/aac/fmp4";
    public $AAC_TS_SEGMENTS_PATH = "audio/aac/ts";

    public function __construct(Encoding $encoding)
    {
        $this->encoding = $encoding;

        $this->renditions = [
            new Rendition(234, 145000),
            new Rendition(360, 365000),
            new Rendition(432, 730000),
            new Rendition(540, 2000000),
            new Rendition(720, 3000000),
        ];
    }
}

class H265AndAc3EncodingTracking
{
    public $encoding;

    public $renditions;
    public $h265VideoStreams;
    public $h265Fmp4Muxings;

    public $ac3AudioStream;
    public $ac3Fmp4Muxing;

    public $H265_FMP4_SEGMENTS_PATH_FORMAT = "video/h265/fmp4/%dp_%d";
    public $AC3_FMP4_SEGMENTS_PATH = "audio/ac3/fmp4";

    public function __construct(Encoding $encoding)
    {
        $this->encoding = $encoding;

        $this->renditions = [
            new Rendition(540, 600000),
            new Rendition(720, 2400000),
            new Rendition(1080, 4500000),
            new Rendition(2160, 11600000),
        ];
    }
}

class Vp9AndVorbisEncodingTracking
{
    public $encoding;

    public $renditions;

    public $vp9WebmMuxing;
    public $vorbisWebmMuxing;

    public $VP9_WEBM_SEGMENTS_PATH_FORMAT = "video/webm/vp9/%dp_%d";
    public $VORBIS_WEBM_SEGMENTS_PATH = "audio/vorbis/webm";

    public function __construct(Encoding $encoding)
    {
        $this->encoding = $encoding;

        $this->renditions = [
            new Rendition(540, 600000),
            new Rendition(720, 2400000),
            new Rendition(1080, 4500000),
            new Rendition(2160, 11600000),
        ];
    }
}

try {
    $bitmovinApi = new BitmovinApi(
        Configuration::create()
            ->apiKey($configProvider->getBitmovinApiKey())
            // uncomment the following line if you are working with a multi-tenant account
            // ->tenantOrgId($configProvider->getBitmovinTenantOrgId())        
            ->logger(new ConsoleLogger())
    );

    $input = createHttpInput($configProvider->getHttpInputHost());
    $inputFilePath = $configProvider->getHttpInputFilePath();

    $output = createS3Output(
        $configProvider->getS3OutputBucketName(),
        $configProvider->getS3OutputAccessKey(),
        $configProvider->getS3OutputSecretKey()
    );

    $h264AndAacEncodingTracking = createH264AndAacEncoding(
        $input,
        $inputFilePath,
        $output
    );
    $h265AndAc3EncodingTracking = createH265AndAc3Encoding(
        $input,
        $inputFilePath,
        $output
    );
    $vp9AndVorbisEncodingTracking = createVp9AndVorbisEncoding(
        $input,
        $inputFilePath,
        $output
    );

    executeEncodings([
        $h264AndAacEncodingTracking->encoding,
        $h265AndAc3EncodingTracking->encoding,
        $vp9AndVorbisEncodingTracking->encoding,
    ]);

    $dashManifest = createDashManifestWithRepresentations(
        $output,
        $h264AndAacEncodingTracking,
        $h265AndAc3EncodingTracking,
        $vp9AndVorbisEncodingTracking
    );
    executeDashManifest($dashManifest);

    $hlsManifest = createHlsManifestWithRepresentations(
        $output,
        $h264AndAacEncodingTracking,
        $h265AndAc3EncodingTracking
    );
    executeHlsManifest($hlsManifest);
} catch (Exception $exception) {
    echo $exception;
}

/**
 * Creates the encoding with H264 codec/TS muxing, H264 codec/CMAF muxing, AAC codec/fMP4 muxing
 *
 * @param Input $input the input that should be used
 * @param string $inputFilePath the path to the input file
 * @param Output $output the output that should be used
 * @return H264AndAacEncodingTracking the tracking information for the encoding
 * @throws BitmovinApiException
 * @throws Exception
 */
function createH264AndAacEncoding(
    Input $input,
    string $inputFilePath,
    Output $output
) {
    $encoding = createEncoding(
        "H.264 Encoding",
        "H.264 -> TS muxing, H.264 -> CMAF muxing, AAC -> fMP4 muxing, AAC -> TS muxing"
    );

    $encodingTracking = new H264AndAacEncodingTracking($encoding);

    foreach ($encodingTracking->renditions as $rendition) {
        $videoConfiguration = createH264Config(
            $rendition->height,
            $rendition->bitrate
        );

        $videoStream = createStream(
            $encoding,
            $input,
            $inputFilePath,
            $videoConfiguration
        );

        $cmafMuxingOutputPath = sprintf(
            $encodingTracking->H264_CMAF_SEGMENTS_PATH_FORMAT,
            $rendition->height,
            $rendition->bitrate
        );

        $tsMuxingOutputPath = sprintf(
            $encodingTracking->H264_TS_SEGMENTS_PATH_FORMAT,
            $rendition->height,
            $rendition->bitrate
        );

        $cmafMuxing = createCmafMuxing(
            $encoding,
            $output,
            $cmafMuxingOutputPath,
            $videoStream
        );
        $tsMuxing = createTsMuxing(
            $encoding,
            $output,
            $tsMuxingOutputPath,
            $videoStream
        );

        $encodingTracking->h264VideoStreams[getKey($rendition)] = $videoStream;
        $encodingTracking->h264CmafMuxings[getKey($rendition)] = $cmafMuxing;
        $encodingTracking->h264TsMuxings[getKey($rendition)] = $tsMuxing;
    }

    // Add an AAC audio stream to the encoding
    $aacConfig = createAacConfig();
    $aacAudioStream = createStream(
        $encoding,
        $input,
        $inputFilePath,
        $aacConfig
    );
    $encodingTracking->aacAudioStream = $aacAudioStream;

    // Create a fMP4 muxing and a TS muxing with the AAC stream
    $encodingTracking->aacFmp4Muxing = createFmp4Muxing(
        $encoding,
        $output,
        $encodingTracking->AAC_FMP4_SEGMENTS_PATH,
        $aacAudioStream
    );

    $encodingTracking->aacTsMuxing = createTsMuxing(
        $encoding,
        $output,
        $encodingTracking->AAC_TS_SEGMENTS_PATH,
        $aacAudioStream
    );

    return $encodingTracking;
}

/**
 * Creates the encoding with H265 codec/fMP4 muxing, AC3 codec/fMP4 muxing
 *
 * @param HttpInput $input the input that should be used
 * @param string $inputFilePath the path to the input file
 * @param Output $output the output that should be used
 * @return H265AndAc3EncodingTracking the tracking information for the encoding
 * @throws BitmovinApiException
 */
function createH265AndAc3Encoding(
    HttpInput $input,
    string $inputFilePath,
    Output $output
) {
    $encoding = createEncoding(
        "H.265 Encoding",
        "H.265 -> fMP4 muxing, AC3 -> fMP4 muxing"
    );
    $encodingTracking = new H265AndAc3EncodingTracking($encoding);

    // Add streams and muxings for h265 encoding
    foreach ($encodingTracking->renditions as $rendition) {
        $videoConfiguration = createH265Config(
            $rendition->height,
            $rendition->bitrate
        );
        $videoStream = createStream(
            $encoding,
            $input,
            $inputFilePath,
            $videoConfiguration
        );
        $fmp4Muxing = createFmp4Muxing(
            $encoding,
            $output,
            sprintf(
                $encodingTracking->H265_FMP4_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            $videoStream
        );

        $encodingTracking->h265VideoStreams[getKey($rendition)] = $videoStream;
        $encodingTracking->h265Fmp4Muxings[getKey($rendition)] = $fmp4Muxing;
    }

    $ac3Config = createAc3Config();
    $encodingTracking->ac3AudioStream = createStream(
        $encoding,
        $input,
        $inputFilePath,
        $ac3Config
    );

    // Create a fMP4 muxing with the AC3 stream
    $encodingTracking->ac3Fmp4Muxing = createFmp4Muxing(
        $encoding,
        $output,
        $encodingTracking->AC3_FMP4_SEGMENTS_PATH,
        $encodingTracking->ac3AudioStream
    );

    return $encodingTracking;
}

/**
 * Created the encoding with VP9 codec/WebM muxing, Vorbis codec / WebM muxing
 *
 * @param HttpInput $input the input that should be used
 * @param string $inputFilePath the path to the input file
 * @param Output $output the output that should be used
 * @return Vp9AndVorbisEncodingTracking the tracking information for the encoding
 * @throws BitmovinApiException
 */
function createVp9AndVorbisEncoding(
    HttpInput $input,
    string $inputFilePath,
    Output $output
) {
    $encoding = createEncoding(
        "VP9/Vorbis Encoding",
        "VP9 -> WebM muxing, Vorbis -> WebM muxing"
    );

    $encodingTracking = new Vp9AndVorbisEncodingTracking($encoding);

    // Create video streams and add webm muxings to the VP9 encoding
    foreach ($encodingTracking->renditions as $rendition) {
        $vp9Config = createVp9Config($rendition->height, $rendition->bitrate);
        $vp9VideoStream = createStream(
            $encoding,
            $input,
            $inputFilePath,
            $vp9Config
        );

        $encodingTracking->vp9WebmMuxing[getKey($rendition)] = createWebmMuxing(
            $encoding,
            $output,
            sprintf(
                $encodingTracking->VP9_WEBM_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            $vp9VideoStream
        );
    }

    // Create Vorbis audio configuration
    $vorbisAudioConfiguration = createVorbisConfig();
    $vorbisAudioStream = createStream(
        $encoding,
        $input,
        $inputFilePath,
        $vorbisAudioConfiguration
    );

    // Create a WebM muxing with the Vorbis audio stream
    $encodingTracking->vorbisWebmMuxing = createWebmMuxing(
        $encoding,
        $output,
        $encodingTracking->VORBIS_WEBM_SEGMENTS_PATH,
        $vorbisAudioStream
    );

    return $encodingTracking;
}

/**
 * Creates the DASH manifest with all the representations.
 *
 * @param Output $output the output that should be used
 * @param H264AndAacEncodingTracking $h264AndAacEncodingTracking the tracking information for the H264/AAC encoding
 * @param H265AndAc3EncodingTracking $h265AndAc3EncodingTracking the tracking information for the H265 encoding
 * @param Vp9AndVorbisEncodingTracking $vp9AndVorbisEncodingTracking the tracking information for the VP9/Vorbis encoding
 * @return DashManifest the created DASH manifest
 * @throws BitmovinApiException
 */
function createDashManifestWithRepresentations(
    Output $output,
    H264AndAacEncodingTracking $h264AndAacEncodingTracking,
    H265AndAc3EncodingTracking $h265AndAc3EncodingTracking,
    Vp9AndVorbisEncodingTracking $vp9AndVorbisEncodingTracking
) {
    global $bitmovinApi;
    $dashManifest = createDashManifest(
        "stream.mpd",
        DashProfile::LIVE(),
        $output,
        "/"
    );

    $period = $bitmovinApi->encoding->manifests->dash->periods->create(
        $dashManifest->id,
        new Period()
    );

    $videoAdaptationSetVp9 = $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->video->create(
        $dashManifest->id,
        $period->id,
        new VideoAdaptationSet()
    );

    $videoAdaptationSetH265 = $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->video->create(
        $dashManifest->id,
        $period->id,
        new VideoAdaptationSet()
    );

    $videoAdaptationSetH264 = $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->video->create(
        $dashManifest->id,
        $period->id,
        new VideoAdaptationSet()
    );

    $vorbisAudioAdaptationSet = createAudioAdaptionSet(
        $dashManifest,
        $period,
        "en"
    );
    $ac3AudioAdaptationSet = createAudioAdaptionSet(
        $dashManifest,
        $period,
        "en"
    );
    $aacAudioAdaptationSet = createAudioAdaptionSet(
        $dashManifest,
        $period,
        "en"
    );

    // Add representations to VP9 adaptation set
    // Add VP9 WEBM muxing to VP9 adaptation set
    foreach ($vp9AndVorbisEncodingTracking->renditions as $rendition) {
        createDashWebmRepresentation(
            $vp9AndVorbisEncodingTracking->encoding,
            $vp9AndVorbisEncodingTracking->vp9WebmMuxing[getKey($rendition)],
            $dashManifest,
            $period,
            sprintf(
                $vp9AndVorbisEncodingTracking->VP9_WEBM_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            $videoAdaptationSetVp9->id
        );
    }

    // Add VORBIS WEBM muxing to VORBIS audio adaptation set
    createDashWebmRepresentation(
        $vp9AndVorbisEncodingTracking->encoding,
        $vp9AndVorbisEncodingTracking->vorbisWebmMuxing,
        $dashManifest,
        $period,
        $vp9AndVorbisEncodingTracking->VORBIS_WEBM_SEGMENTS_PATH,
        $vorbisAudioAdaptationSet->id
    );

    // Add representations to H265 adaptation set
    // Add H265 FMP4 muxing to H265 video adaptation set
    foreach ($h265AndAc3EncodingTracking->renditions as $rendition) {
        createDashFmp4Representation(
            $h265AndAc3EncodingTracking->encoding,
            $h265AndAc3EncodingTracking->h265Fmp4Muxings[getKey($rendition)],
            $dashManifest,
            $period,
            sprintf(
                $h265AndAc3EncodingTracking->H265_FMP4_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            $videoAdaptationSetH265->id
        );
    }

    // Add AC3 FMP4 muxing to AAC audio adaptation set
    createDashFmp4Representation(
        $h265AndAc3EncodingTracking->encoding,
        $h265AndAc3EncodingTracking->ac3Fmp4Muxing,
        $dashManifest,
        $period,
        $h265AndAc3EncodingTracking->AC3_FMP4_SEGMENTS_PATH,
        $ac3AudioAdaptationSet->id
    );

    // Add representations to H264 adaptation set
    // Add H264 CMAF muxing to H264 video adaptation set
    foreach ($h264AndAacEncodingTracking->renditions as $rendition) {
        createDashCmafRepresentation(
            $h264AndAacEncodingTracking->encoding,
            $h264AndAacEncodingTracking->h264CmafMuxings[getKey($rendition)],
            $dashManifest,
            $period,
            sprintf(
                $h264AndAacEncodingTracking->H264_CMAF_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            $videoAdaptationSetH264->id
        );
    }

    // Add AAC FMP4 muxing to AAC audio adaptation set
    createDashFmp4Representation(
        $h264AndAacEncodingTracking->encoding,
        $h264AndAacEncodingTracking->aacFmp4Muxing,
        $dashManifest,
        $period,
        $h264AndAacEncodingTracking->AAC_FMP4_SEGMENTS_PATH,
        $aacAudioAdaptationSet->id
    );

    return $dashManifest;
}

/**
 * Creates the HLS manifest master playlist with the different sub playlists
 *
 * @param Output $output the output that should be used
 * @param H264AndAacEncodingTracking $h264AndAacEncodingTracking the tracking information for the H264/AAC encoding
 * @param H265AndAc3EncodingTracking $h265AndAc3EncodingTracking the tracking information for the H265 encoding
 * @return HlsManifest the created HLS manifest
 * @throws BitmovinApiException
 */
function createHlsManifestWithRepresentations(
    Output $output,
    H264AndAacEncodingTracking $h264AndAacEncodingTracking,
    H265AndAc3EncodingTracking $h265AndAc3EncodingTracking
) {
    $hlsManifest = createHlsMasterManifest("master.m3u8", $output, "/");

    // Create h265 audio playlists
    createAudioMediaPlaylist(
        $h265AndAc3EncodingTracking->encoding,
        $hlsManifest,
        $h265AndAc3EncodingTracking->ac3Fmp4Muxing,
        $h265AndAc3EncodingTracking->ac3AudioStream,
        "audio_ac3_fmp4.m3u8",
        $h265AndAc3EncodingTracking->AC3_FMP4_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_AC3_FMP4
    );

    // Create h265 video playlists
    foreach ($h265AndAc3EncodingTracking->renditions as $rendition) {
        createVideoStreamPlaylist(
            $h265AndAc3EncodingTracking->encoding,
            $hlsManifest,
            $h265AndAc3EncodingTracking->h265Fmp4Muxings[getKey($rendition)],
            $h265AndAc3EncodingTracking->h265VideoStreams[getKey($rendition)],
            sprintf(
                "video_h265_%dp_%d.m3u8",
                $rendition->height,
                $rendition->bitrate
            ),
            sprintf(
                $h265AndAc3EncodingTracking->H265_FMP4_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            HLS_AUDIO_GROUP_AC3_FMP4
        );
    }

    // Create h264 audio playlists
    createAudioMediaPlaylist(
        $h264AndAacEncodingTracking->encoding,
        $hlsManifest,
        $h264AndAacEncodingTracking->aacFmp4Muxing,
        $h264AndAacEncodingTracking->aacAudioStream,
        "audio_aac_fmp4.m3u8",
        $h264AndAacEncodingTracking->AAC_FMP4_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_AAC_FMP4
    );

    createAudioMediaPlaylist(
        $h264AndAacEncodingTracking->encoding,
        $hlsManifest,
        $h264AndAacEncodingTracking->aacTsMuxing,
        $h264AndAacEncodingTracking->aacAudioStream,
        "audio_aac_ts.m3u8",
        $h264AndAacEncodingTracking->AAC_TS_SEGMENTS_PATH,
        HLS_AUDIO_GROUP_AAC_TS
    );

    // Create h264 video playlists
    foreach ($h264AndAacEncodingTracking->renditions as $rendition) {
        createVideoStreamPlaylist(
            $h264AndAacEncodingTracking->encoding,
            $hlsManifest,
            $h264AndAacEncodingTracking->h264TsMuxings[getKey($rendition)],
            $h264AndAacEncodingTracking->h264VideoStreams[getKey($rendition)],
            sprintf(
                "video_h264_%dp_%d.m3u8",
                $rendition->height,
                $rendition->bitrate
            ),
            sprintf(
                $h264AndAacEncodingTracking->H264_TS_SEGMENTS_PATH_FORMAT,
                $rendition->height,
                $rendition->bitrate
            ),
            HLS_AUDIO_GROUP_AAC_TS
        );
    }

    return $hlsManifest;
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
 * @param Encoding[] $encodings The encodings to be started
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeEncodings(array $encodings)
{
    global $bitmovinApi;

    foreach ($encodings as $encoding) {
        $bitmovinApi->encoding->encodings->start($encoding->id);
    }

    do {
        sleep(5);
        $allFinished = true;

        foreach ($encodings as $encoding) {
            $task = $bitmovinApi->encoding->encodings->status($encoding->id);
            echo 'Encoding status is ' .
                $task->status .
                ' (progress: ' .
                $task->progress .
                ' %)' .
                PHP_EOL;

            if ($task->status == Status::ERROR()) {
                logTaskErrors($task);
                throw new Exception('Encoding failed');
            }

            if ($task->status != Status::FINISHED()) {
                $allFinished = false;
            }
        }
    } while (!$allFinished);

    echo 'Encoding finished successfully' . PHP_EOL;
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
 * @param DashManifest $dashManifest The dash manifest to be started
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeDashManifest(DashManifest $dashManifest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->manifests->dash->start($dashManifest->id);

    do {
        sleep(5);
        $task = $bitmovinApi->encoding->manifests->dash->status(
            $dashManifest->id
        );
    } while (
        $task->status != Status::FINISHED() &&
        $task->status != Status::ERROR()
    );

    if ($task->status == Status::ERROR()) {
        logTaskErrors($task);
        throw new Exception('DASH manifest failed');
    }

    echo 'DASH manifest finished successfully' . PHP_EOL;
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
 * @param HlsManifest $hlsManifest The dash manifest to be started
 * @throws BitmovinApiException
 * @throws Exception
 */
function executeHlsManifest(HlsManifest $hlsManifest)
{
    global $bitmovinApi;

    $bitmovinApi->encoding->manifests->hls->start($hlsManifest->id);

    do {
        sleep(5);
        $task = $bitmovinApi->encoding->manifests->hls->status(
            $hlsManifest->id
        );
    } while (
        $task->status != Status::FINISHED() &&
        $task->status != Status::ERROR()
    );

    if ($task->status == Status::ERROR()) {
        logTaskErrors($task);
        throw new Exception('HLS manifest failed');
    }

    echo 'HLS manifest finished successfully' . PHP_EOL;
}

/**
 * Creates a CMAF muxing. This will generate segments with a given segment length for adaptive
 * streaming.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsCmafByEncodingId
 *
 * @param Encoding $encoding The encoding to add the muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragmented segments will be written to
 * @param Stream $stream The stream that is associated with the muxing
 * @return CmafMuxing
 * @throws Exception
 */
function createCmafMuxing(
    Encoding $encoding,
    Output $output,
    string $outputPath,
    Stream $stream
) {
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new CmafMuxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams([$muxingStream]);
    $muxing->segmentLength(4.0);

    return $bitmovinApi->encoding->encodings->muxings->cmaf->create(
        $encoding->id,
        $muxing
    );
}

/**
 * Creates an fMP4 muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param Encoding $encoding The encoding to add the fMP4 muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @param Stream $stream An array of streams to be added to the muxing
 * @return Fmp4Muxing
 * @throws BitmovinApiException
 * @throws Exception
 */
function createFmp4Muxing(
    Encoding $encoding,
    Output $output,
    string $outputPath,
    Stream $stream
) {
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new Fmp4Muxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams([$muxingStream]);
    $muxing->segmentLength(4.0);

    return $bitmovinApi->encoding->encodings->muxings->fmp4->create(
        $encoding->id,
        $muxing
    );
}

/**
 * Creates a TS muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsTsByEncodingId
 *
 * @param Encoding $encoding The encoding to add the muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @param Stream $stream An array of streams to be added to the muxing
 * @return TsMuxing
 * @throws BitmovinApiException
 * @throws Exception
 */
function createTsMuxing(
    Encoding $encoding,
    Output $output,
    string $outputPath,
    Stream $stream
) {
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new TsMuxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams([$muxingStream]);
    $muxing->segmentLength(4.0);

    return $bitmovinApi->encoding->encodings->muxings->ts->create(
        $encoding->id,
        $muxing
    );
}

/**
 * Creates a progressive WebM muxing.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsTsByEncodingId
 *
 * @param Encoding $encoding The encoding to add the muxing to
 * @param Output $output The output that should be used for the muxing to write the segments to
 * @param string $outputPath The output path where the fragments will be written to
 * @param Stream $stream An array of streams to be added to the muxing
 * @return WebmMuxing
 * @throws BitmovinApiException
 * @throws Exception
 */
function createWebmMuxing(
    Encoding $encoding,
    Output $output,
    string $outputPath,
    Stream $stream
) {
    global $bitmovinApi;

    $muxingStream = new MuxingStream();
    $muxingStream->streamId($stream->id);

    $muxing = new WebmMuxing();
    $muxing->outputs([buildEncodingOutput($output, $outputPath)]);
    $muxing->streams([$muxingStream]);
    $muxing->segmentLength(4.0);

    return $bitmovinApi->encoding->encodings->muxings->webm->create(
        $encoding->id,
        $muxing
    );
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
 *
 * @return H264VideoConfiguration
 * @throws BitmovinApiException
 */
function createH264Config(int $height, int $bitrate)
{
    global $bitmovinApi;

    $h264Config = new H264VideoConfiguration();
    $h264Config->name(sprintf("H.264 %dp", $height));
    $h264Config->presetConfiguration(PresetConfiguration::VOD_STANDARD());
    $h264Config->height($height);
    $h264Config->bitrate($bitrate);

    return $bitmovinApi->encoding->configurations->video->h264->create(
        $h264Config
    );
}

/**
 * Creates a basic H.265 video configuration. The width of the video will be set accordingly to the
 * aspect ratio of the source video.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
 * @return H265VideoConfiguration
 * @throws BitmovinApiException
 */
function createH265Config(int $height, int $bitrate)
{
    global $bitmovinApi;

    $h265Config = new H265VideoConfiguration();
    $h265Config->name(sprintf("H.264 %dp", $height));
    $h265Config->presetConfiguration(PresetConfiguration::VOD_STANDARD());
    $h265Config->height($height);
    $h265Config->bitrate($bitrate);

    return $bitmovinApi->encoding->configurations->video->h265->create(
        $h265Config
    );
}

/**
 * Creates a base VP9 video configuration. The width of the video will be set accordingly to the
 * aspect ratio of the source video.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoVp9
 * @return Vp9VideoConfiguration
 * @throws BitmovinApiException
 */
function createVp9Config(int $height, int $bitrate)
{
    global $bitmovinApi;

    $vp9Config = new Vp9VideoConfiguration();
    $vp9Config->name(sprintf("VP9 %dp", $height));
    $vp9Config->presetConfiguration(PresetConfiguration::VOD_STANDARD());
    $vp9Config->height($height);
    $vp9Config->bitrate($bitrate);

    return $bitmovinApi->encoding->configurations->video->vp9->create(
        $vp9Config
    );
}

/**
 * Creates a configuration for the AAC audio codec to be applied to audio streams.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
 * @return AacAudioConfiguration
 * @throws BitmovinApiException
 */
function createAacConfig()
{
    global $bitmovinApi;

    $aacConfig = new AacAudioConfiguration();
    $aacConfig->name("AAC 128 kbit/s");
    $aacConfig->bitrate(128000);

    return $bitmovinApi->encoding->configurations->audio->aac->create(
        $aacConfig
    );
}

/**
 * Creates an AC3 audio configuration. The sample rate of the audio will be set accordingly to the
 * sample rate of the source audio.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAc3
 * @return Ac3AudioConfiguration
 * @throws BitmovinApiException
 */
function createAc3Config()
{
    global $bitmovinApi;

    $ac3Config = new Ac3AudioConfiguration();
    $ac3Config->name("AC3 128 kbit/s");
    $ac3Config->bitrate(128000);

    return $bitmovinApi->encoding->configurations->audio->ac3->create(
        $ac3Config
    );
}

/**
 * Creates a Vorbis audio configuration. The sample rate of the audio will be set accordingly to
 * the sample rate of the source audio.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioVorbis
 *
 * @throws BitmovinApiException
 */
function createVorbisConfig()
{
    global $bitmovinApi;

    $vorbisConfig = new VorbisAudioConfiguration();
    $vorbisConfig->name("AC3 128 kbit/s");
    $vorbisConfig->bitrate(128000);

    return $bitmovinApi->encoding->configurations->audio->vorbis->create(
        $vorbisConfig
    );
}

/**
 * Adds a video or audio stream to an encoding
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
 *
 * @param Encoding $encoding The encoding to which the stream will be added
 * @param Input $input The input resource providing the input file
 * @param string $inputPath The path to the input file
 * @param CodecConfiguration $codecConfiguration The codec configuration to be applied to the stream
 * @return Stream
 * @throws BitmovinApiException
 */
function createStream(
    Encoding $encoding,
    Input $input,
    string $inputPath,
    CodecConfiguration $codecConfiguration
) {
    global $bitmovinApi;

    $streamInput = new StreamInput();
    $streamInput->inputId($input->id);
    $streamInput->inputPath($inputPath);

    $stream = new Stream();
    $stream->inputStreams([$streamInput]);
    $stream->codecConfigId($codecConfiguration->id);

    return $bitmovinApi->encoding->encodings->streams->create(
        $encoding->id,
        $stream
    );
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
 * @param string $bucketName The name of the S3 bucket
 * @param string $accessKey The access key of your S3 account
 * @param string $secretKey The secret key of your S3 account
 * @return S3Output
 * @throws BitmovinApiException
 */
function createS3Output(
    string $bucketName,
    string $accessKey,
    string $secretKey
) {
    global $bitmovinApi;

    $output = new S3Output();
    $output->bucketName($bucketName);
    $output->accessKey($accessKey);
    $output->secretKey($secretKey);

    return $bitmovinApi->encoding->outputs->s3->create($output);
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
 * @param string $host The hostname or IP address of the HTTP server e.g.: my-storage.biz
 * @return HttpInput
 * @throws BitmovinApiException
 */
function createHttpInput(string $host)
{
    global $bitmovinApi;

    $input = new HttpInput();
    $input->host($host);

    return $bitmovinApi->encoding->inputs->http->create($input);
}

/**
 * Creates an Encoding object. This is the base object to configure your encoding.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
 *
 * @param string $name A name that will help you identify the encoding in our dashboard (required)
 * @param string $description description A description of the encoding (optional)
 * @return Encoding
 * @throws BitmovinApiException
 */
function createEncoding(string $name, string $description)
{
    global $bitmovinApi;

    $encoding = new Encoding();
    $encoding->name($name);
    $encoding->description($description);

    return $bitmovinApi->encoding->encodings->create($encoding);
}

/**
 * Creates a DASH manifest
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
 *
 * @param String $name the resource name
 * @param DashProfile $dashProfile the DASH profile of the manifest (ON_DEMAND, LIVE)
 * @param Output $output the output of the manifest
 * @param string $outputPath the output path where the manifest is written to
 * @return DashManifest the created manifest
 * @throws BitmovinApiException
 * @throws Exception
 */
function createDashManifest(
    string $name,
    DashProfile $dashProfile,
    Output $output,
    string $outputPath
) {
    global $bitmovinApi;

    $dashManifest = new DashManifest();
    $dashManifest->name($name);
    $dashManifest->profile($dashProfile);
    $dashManifest->outputs([buildEncodingOutput($output, $outputPath)]);

    return $bitmovinApi->encoding->manifests->dash->create($dashManifest);
}

/**
 * Creates the HLS master manifest.
 *
 * @throws BitmovinApiException
 * @throws Exception
 */
function createHlsMasterManifest(
    string $name,
    Output $output,
    string $outputPath
) {
    global $bitmovinApi;

    $hlsManifest = new HlsManifest();
    $hlsManifest->name($name);
    $hlsManifest->outputs([buildEncodingOutput($output, $outputPath)]);

    return $bitmovinApi->encoding->manifests->hls->create($hlsManifest);
}

/**
 * Creates an HLS audio media playlist.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaAudioByManifestId
 *
 * @param Encoding $encoding the encoding where the resources belong to
 * @param HlsManifest $manifest the manifest where the audio playlist should be added
 * @param Muxing $audioMuxing the audio muxing that should be used
 * @param Stream $audioStream the audio stream of the muxing
 * @param string $audioSegmentsPath the path to the audio segments
 * @throws BitmovinApiException
 */
function createAudioMediaPlaylist(
    Encoding $encoding,
    HlsManifest $manifest,
    Muxing $audioMuxing,
    Stream $audioStream,
    string $uri,
    string $audioSegmentsPath,
    string $audioGroup
) {
    global $bitmovinApi;
    $audioMediaInfo = new AudioMediaInfo();
    $audioMediaInfo->name($uri);
    $audioMediaInfo->uri($uri);
    $audioMediaInfo->groupId($audioGroup);
    $audioMediaInfo->encodingId($encoding->id);
    $audioMediaInfo->streamId($audioStream->id);
    $audioMediaInfo->muxingId($audioMuxing->id);
    $audioMediaInfo->language("en");
    $audioMediaInfo->assocLanguage("en");
    $audioMediaInfo->autoselect(false);
    $audioMediaInfo->isDefault(false);
    $audioMediaInfo->forced(false);
    $audioMediaInfo->segmentPath($audioSegmentsPath);

    $bitmovinApi->encoding->manifests->hls->media->audio->create(
        $manifest->id,
        $audioMediaInfo
    );
}

/**
 * Creates an HLS video playlist
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
 *
 * @param Encoding $encoding the encoding where the resources belong to
 * @param HlsManifest $manifest the master manifest where the video stream playlist should belong to
 * @param Muxing $videoMuxing the muxing that should be used
 * @param Stream $videoStream the stream of the muxing
 * @param string $uri the relative uri of the playlist file that will be generated
 * @param string $segmentPath the path pointing to the respective video segments
 * @throws BitmovinApiException
 */
function createVideoStreamPlaylist(
    Encoding $encoding,
    HlsManifest $manifest,
    Muxing $videoMuxing,
    Stream $videoStream,
    string $uri,
    string $segmentPath,
    string $audioGroup
) {
    global $bitmovinApi;
    $streamInfo = new StreamInfo();
    $streamInfo->uri($uri);
    $streamInfo->encodingId($encoding->id);
    $streamInfo->streamId($videoStream->id);
    $streamInfo->muxingId($videoMuxing->id);
    $streamInfo->audio($audioGroup);
    $streamInfo->segmentPath($segmentPath);

    $bitmovinApi->encoding->manifests->hls->streams->create(
        $manifest->id,
        $streamInfo
    );
}

/**
 * Creates a DASH representation.
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
 *
 * @param Encoding $encoding the encoding where the resources belong to
 * @param Fmp4Muxing $muxing the respective audio muxing
 * @param DashManifest $dashManifest the dash manifest to which the representation should be added
 * @param Period $period the DASH period
 * @param string $segmentPath the path the the CMAF segments
 * @param string $adaptationSetId the adaptation set to which the representation should be added
 * @throws BitmovinApiException
 */
function createDashFmp4Representation(
    Encoding $encoding,
    Fmp4Muxing $muxing,
    DashManifest $dashManifest,
    Period $period,
    string $segmentPath,
    string $adaptationSetId
) {
    global $bitmovinApi;

    $dashFmp4H264Representation = new DashFmp4Representation();
    $dashFmp4H264Representation->type(DashRepresentationType::TEMPLATE());
    $dashFmp4H264Representation->encodingId($encoding->id);
    $dashFmp4H264Representation->muxingId($muxing->id);
    $dashFmp4H264Representation->segmentPath($segmentPath);

    $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->representations->fmp4->create(
        $dashManifest->id,
        $period->id,
        $adaptationSetId,
        $dashFmp4H264Representation
    );
}

/**
 * Creates a DASH CMAF representation
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsCmafByManifestIdAndPeriodIdAndAdaptationsetId
 *
 * @param Encoding $encoding the encoding where the resources belong to
 * @param CmafMuxing $muxing the muxing that should be used for this representation
 * @param DashManifest $dashManifest the dash manifest to which the representation should be added
 * @param Period $period the period to which the representation should be added
 * @param string $segmentPath the path the the CMAF segments
 * @param string $adaptationSetId the adaptation set to which the representation should be added
 * @throws BitmovinApiException
 */
function createDashCmafRepresentation(
    Encoding $encoding,
    CmafMuxing $muxing,
    DashManifest $dashManifest,
    Period $period,
    string $segmentPath,
    string $adaptationSetId
) {
    global $bitmovinApi;

    $dashCmafRepresentation = new DashCmafRepresentation();
    $dashCmafRepresentation->type(DashRepresentationType::TEMPLATE());
    $dashCmafRepresentation->encodingId($encoding->id);
    $dashCmafRepresentation->muxingId($muxing->id);
    $dashCmafRepresentation->segmentPath($segmentPath);

    $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->representations->cmaf->create(
        $dashManifest->id,
        $period->id,
        $adaptationSetId,
        $dashCmafRepresentation
    );
}

/**
 * Creates a DASH WEBM representation
 *
 * <p>API endpoint:
 * https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsWebmByManifestIdAndPeriodIdAndAdaptationsetId
 *
 * @param Encoding $encoding the encoding where the resources belong to
 * @param WebmMuxing $muxing the muxing that should be used for this representation
 * @param DashManifest $dashManifest the dash manifest to which the representation should be added
 * @param Period $period the period to which the represenation should be added
 * @param string $segmentPath the path to the WEBM segments
 * @param string $adaptationSetId the adaptationset to which the representation should be added
 * @throws BitmovinApiException
 */
function createDashWebmRepresentation(
    Encoding $encoding,
    WebmMuxing $muxing,
    DashManifest $dashManifest,
    Period $period,
    string $segmentPath,
    string $adaptationSetId
) {
    global $bitmovinApi;

    $dashWebmRepresentation = new DashWebmRepresentation();
    $dashWebmRepresentation->type(DashRepresentationType::TEMPLATE());
    $dashWebmRepresentation->encodingId($encoding->id);
    $dashWebmRepresentation->muxingId($muxing->id);
    $dashWebmRepresentation->segmentPath($segmentPath);

    $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->representations->webm->create(
        $dashManifest->id,
        $period->id,
        $adaptationSetId,
        $dashWebmRepresentation
    );
}

/** Creates an audio adaption set for the dash manifest
 * @return AudioAdaptationSet
 * @throws BitmovinApiException
 */
function createAudioAdaptionSet(
    DashManifest $dashManifest,
    Period $period,
    string $language
) {
    global $bitmovinApi;

    $audioAdaptationSet = new AudioAdaptationSet();
    $audioAdaptationSet->lang($language);

    return $bitmovinApi->encoding->manifests->dash->periods->adaptationsets->audio->create(
        $dashManifest->id,
        $period->id,
        $audioAdaptationSet
    );
}

/**
 * Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
 * be written to. Public read permissions will be set for the files written, so they can be
 * accessed easily via HTTP.
 *
 * @param Output $output The output resource to be used by the EncodingOutput
 * @param string $outputPath The path where the content will be written to
 * @return EncodingOutput
 * @throws Exception
 */
function buildEncodingOutput(Output $output, string $outputPath)
{
    $aclEntry = new AclEntry();
    $aclEntry->permission(AclPermission::PUBLIC_READ());

    $encodingOutput = new EncodingOutput();
    $encodingOutput->outputPath(buildAbsolutePath($outputPath));
    $encodingOutput->outputId($output->id);
    $encodingOutput->acl([$aclEntry]);

    return $encodingOutput;
}

/**
 * Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
 * name of this example and the given relative path
 *
 * <p>e.g.: /s3/base/path/exampleName/relative/path
 *
 * @param string $relativePath The relaitve path that is concatenated
 * @return string
 * @throws Exception
 */
function buildAbsolutePath(string $relativePath)
{
    global $DATE_STRING, $exampleName, $configProvider;

    return $configProvider->getS3OutputBasePath() .
        $exampleName .
        "-" .
        $DATE_STRING .
        DIRECTORY_SEPARATOR .
        trim($relativePath, DIRECTORY_SEPARATOR);
}

function logTaskErrors(Task $task)
{
    if ($task->messages == null) {
        return;
    }

    $messages = array_filter($task->messages, function ($msg) {
        return $msg->type == MessageType::ERROR();
    });

    foreach ($messages as $message) {
        echo $message->text . PHP_EOL;
    }
}

function getKey(Rendition $rendition)
{
    return $rendition->height . "p" . $rendition->bitrate;
}
