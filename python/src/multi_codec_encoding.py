import time
import concurrent.futures

from datetime import datetime
from os import path

from bitmovin_api_sdk import AacAudioConfiguration, Ac3AudioConfiguration, Ac3ChannelLayout, AclEntry, AclPermission, \
    AudioAdaptationSet, AudioMediaInfo, BitmovinApi, BitmovinApiLogger, CmafMuxing, CodecConfiguration, \
    DashCmafRepresentation, DashFmp4Representation, DashManifest, DashProfile, DashRepresentationType, Encoding, \
    EncodingOutput, Fmp4Muxing, H264VideoConfiguration, H265VideoConfiguration, HlsManifest, HttpInput, Input, \
    MessageType, Muxing, MuxingStream, Output, Period, PresetConfiguration, S3Output, Status, Stream, StreamInfo, \
    StreamInput, Task, TsMuxing, VideoAdaptationSet, VorbisAudioConfiguration, Vp9VideoConfiguration, WebmMuxing

from common.config_provider import ConfigProvider

"""
This example demonstrates how to use different codecs and muxing types in a single encoding.

<p>The following configuration parameters are expected:

<ul>
  <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
  <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
      e.g.: my-storage.biz
  <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
      videos/1080p_Sintel.mp4
  <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
  <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
  <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
  <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
      Example: /outputs
</ul>

<p>Configuration parameters will be retrieved from these sources in the listed order:

<ol>
  <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
  <li>properties file located in the root folder of the JAVA examples at ./examples.properties
      (see examples.properties.template as reference)
  <li>environment variables
  <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
      examples.properties.template as reference)
</ol>
"""

EXAMPLE_NAME = "MultiCodecEncoding-{}".format(datetime.now().isoformat(timespec='seconds'))
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(), logger=BitmovinApiLogger())

HLS_AUDIO_GROUP_AAC_FMP4 = "audio-aac-fmp4"
HLS_AUDIO_GROUP_AAC_TS = "audio-aac-ts"
HLS_AUDIO_GROUP_AC3_FMP4 = "audio-ac3-fmp4"

H264_TS_SEGMENTS_PATH_FORMAT = "video/h264/ts/{}p_{}"
H264_CMAF_SEGMENTS_PATH_FORMAT = "video/h264/cmaf/{}p_{}"
AAC_FMP4_SEGMENTS_PATH = "audio/aac/fmp4"
AAC_TS_SEGMENTS_PATH = "audio/aac/ts"

H265_FMP4_SEGMENTS_PATH_FORMAT = "video/h265/fmp4/{}p_{}"
AC3_FMP4_SEGMENTS_PATH = "audio/ac3/fmp4"

VP9_WEBM_SEGMENTS_PATH_FORMAT = "video/webm/vp9/{}p_{}"
VORBIS_WEBM_SEGMENTS_PATH = "audio/vorbis/webm"


class Rendition:
    def __init__(self, height, bitrate):
        # type: (int, int) -> None
        self.height = height
        self.bitrate = bitrate


class H264AndAacEncodingTracking:
    def __init__(self, encoding):
        # type: (Encoding) -> None

        self.encoding = encoding

        self.aac_audio_stream = None
        self.aac_fmp4_muxing = None
        self.aac_ts_muxing = None

        self.h264_video_streams = {}
        self.h264_cmaf_muxings = {}
        self.h264_ts_muxings = {}

        self.renditions = [Rendition(height=234, bitrate=145000),
                           Rendition(height=360, bitrate=365000),
                           Rendition(height=432, bitrate=730000),
                           Rendition(height=540, bitrate=2000000),
                           Rendition(height=720, bitrate=3000000)]


class H265AndAc3EncodingTracking:
    def __init__(self, encoding):
        # type: (Encoding) -> None

        self.encoding = encoding

        self.ac3_audio_stream = None
        self.ac3_fmp4_muxing = None

        self.h265_video_streams = {}
        self.h265_fmp4_muxings = {}

        self.renditions = [Rendition(height=540, bitrate=600000),
                           Rendition(height=720, bitrate=2400000),
                           Rendition(height=1080, bitrate=4500000),
                           Rendition(height=2160, bitrate=11600000)]


class Vp9AndVorbisEncodingTracking:
    def __init__(self, encoding):
        # type: (Encoding) -> None

        self.encoding = encoding

        self.vp9_webm_muxings = {}
        self.vorbis_webm_muxing = None

        self.renditions = [Rendition(height=540, bitrate=600000),
                           Rendition(height=720, bitrate=2400000),
                           Rendition(height=1080, bitrate=4500000),
                           Rendition(height=2160, bitrate=11600000)]


def main():
    http_input = _create_http_input(host=config_provider.get_http_input_host())
    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    input_path = config_provider.get_http_input_file_path()

    h264_and_aac_encoding_tracking = _create_h264_and_aac_encoding(
        encoding_input=http_input,
        input_path=input_path,
        output=output
    )

    h265_and_ac3_encoding_tracking = _create_h265_and_ac3_encoding(
        encoding_input=http_input,
        input_path=input_path,
        output=output
    )

    vp9_and_vorbis_encoding_tracking = _create_vp9_and_vorbis_encoding(
        encoding_input=http_input,
        input_path=input_path,
        output=output
    )

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        executor.map(_execute_encoding, [
            h264_and_aac_encoding_tracking.encoding,
            h265_and_ac3_encoding_tracking.encoding,
            vp9_and_vorbis_encoding_tracking.encoding
        ])

    dash_manifest = _extend_dash_manifest(
        output=output,
        h264_and_aac_encoding_tracking=h264_and_aac_encoding_tracking,
        h265_and_ac3_encoding_tracking=h265_and_ac3_encoding_tracking,
        vp9_and_vorbis_encoding_tracking=vp9_and_vorbis_encoding_tracking
    )
    _execute_dash_manifest(dash_manifest=dash_manifest)

    hls_manifest = _extend_hls_manifest(
        output=output,
        h264_and_aac_encoding_tracking=h264_and_aac_encoding_tracking,
        h265_and_ac3_encoding_tracking=h265_and_ac3_encoding_tracking
    )
    _execute_hls_manifest(hls_manifest=hls_manifest)


def _create_h264_and_aac_encoding(encoding_input, input_path, output):
    # type: (Input, str, Output) -> H264AndAacEncodingTracking
    """
    Creates the encoding with H264 codec/TS muxing, H264 codec/CMAF muxing, AAC codec/fMP4 muxing

    :param encoding_input: the input that should be used
    :param input_path: the path to the input file
    :param output: the output that should be used
    :return: the tracking information for the encoding
    """

    encoding = _create_encoding(
        name="H.264 Encoding",
        description="H.264 -> TS muxing, H.264 -> CMAF muxing, AAC -> fMP4 muxing"
    )
    encoding_tracking = H264AndAacEncodingTracking(encoding=encoding)

    for rendition in encoding_tracking.renditions:
        video_configuration = _create_h264_video_configuration(height=rendition.height, bitrate=rendition.bitrate)
        video_stream = _create_stream(
            encoding=encoding,
            encoding_input=encoding_input,
            input_path=input_path,
            codec_configuration=video_configuration
        )

        cmaf_muxing = _create_cmaf_muxing(
            encoding=encoding,
            output=output,
            output_path=H264_CMAF_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            stream=video_stream
        )
        ts_muxing = _create_ts_muxing(
            encoding=encoding,
            output=output,
            output_path=H264_TS_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            stream=video_stream
        )

        encoding_tracking.h264_video_streams[rendition] = video_stream
        encoding_tracking.h264_cmaf_muxings[rendition] = cmaf_muxing
        encoding_tracking.h264_ts_muxings[rendition] = ts_muxing

    aac_config = _create_aac_audio_configuration()
    aac_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=encoding_input,
        input_path=input_path,
        codec_configuration=aac_config
    )

    encoding_tracking.aac_audio_stream = aac_audio_stream
    encoding_tracking.aac_fmp4_muxing = _create_fmp4_muxing(
        encoding=encoding,
        output=output,
        output_path=AAC_FMP4_SEGMENTS_PATH,
        stream=aac_audio_stream
    )
    encoding_tracking.aac_ts_muxing = _create_ts_muxing(
        encoding=encoding,
        output=output,
        output_path=AAC_TS_SEGMENTS_PATH,
        stream=aac_audio_stream
    )

    return encoding_tracking


def _create_h265_and_ac3_encoding(encoding_input, input_path, output):
    # type: (Input, str, Output) -> H265AndAc3EncodingTracking
    """
    Creates the encoding with H265 codec/fMP4 muxing, AC3 codec/fMP4 muxing

    :param encoding_input: the input that should be used
    :param input_path: the path to the input file
    :param output: the output that should be used
    :return: the tracking information for the encoding
    """

    encoding = _create_encoding(name="H.265 Encoding", description="H.265 -> fMP4 muxing, AC3 -> fMP4 muxing")
    encoding_tracking = H265AndAc3EncodingTracking(encoding=encoding)

    for rendition in encoding_tracking.renditions:
        video_configuration = _create_h265_video_configuration(height=rendition.height, bitrate=rendition.bitrate)
        video_stream = _create_stream(
            encoding=encoding,
            encoding_input=encoding_input,
            input_path=input_path,
            codec_configuration=video_configuration
        )

        fmp4_muxing = _create_fmp4_muxing(
            encoding=encoding,
            output=output,
            output_path=H265_FMP4_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            stream=video_stream
        )

        encoding_tracking.h265_video_streams[rendition] = video_stream
        encoding_tracking.h265_fmp4_muxings[rendition] = fmp4_muxing

    ac3_config = _create_ac3_audio_configuration()
    ac3_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=encoding_input,
        input_path=input_path,
        codec_configuration=ac3_config
    )

    encoding_tracking.ac3_audio_stream = ac3_audio_stream
    encoding_tracking.ac3_fmp4_muxing = _create_fmp4_muxing(
        encoding=encoding,
        output=output,
        output_path=AC3_FMP4_SEGMENTS_PATH,
        stream=ac3_audio_stream
    )

    return encoding_tracking


def _create_vp9_and_vorbis_encoding(encoding_input, input_path, output):
    # type: (Input, str, Output) -> Vp9AndVorbisEncodingTracking
    """
    Created the encoding with VP9 codec/WebM muxing, Vorbis codec / WebM muxing

    :param encoding_input: the input that should be used
    :param input_path: the path to the input file
    :param output: the output that should be used
    :return: the tracking information for the encoding
    """

    encoding = _create_encoding(name="VP9/Vorbis Encoding", description="VP9 -> WebM muxing, Vorbis -> WebM muxing")

    encoding_tracking = Vp9AndVorbisEncodingTracking(encoding=encoding)

    for rendition in encoding_tracking.renditions:
        vp9_config = _create_vp9_video_configuration(rendition.height, rendition.bitrate)
        vp9_video_stream = _create_stream(
            encoding=encoding,
            encoding_input=encoding_input,
            input_path=input_path,
            codec_configuration=vp9_config
        )

        encoding_tracking.vp9_webm_muxings[rendition] = _create_webm_muxing(
            encoding=encoding,
            output=output,
            output_path=VP9_WEBM_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            stream=vp9_video_stream
        )

    vorbis_audio_configuration = _create_vorbis_audio_configuration()
    vorbis_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=encoding_input,
        input_path=input_path,
        codec_configuration=vorbis_audio_configuration
    )

    encoding_tracking.vorbis_webm_muxing = _create_webm_muxing(
        encoding=encoding,
        output=output,
        output_path=VORBIS_WEBM_SEGMENTS_PATH,
        stream=vorbis_audio_stream
    )

    return encoding_tracking


def _extend_dash_manifest(output,
                          h264_and_aac_encoding_tracking,
                          h265_and_ac3_encoding_tracking,
                          vp9_and_vorbis_encoding_tracking):
    # type: (Output, H264AndAacEncodingTracking, H265AndAc3EncodingTracking, Vp9AndVorbisEncodingTracking) -> DashManifest
    """
    Creates the DASH manifest with all the representations.

    :param output: the output that should be used
    :param h264_and_aac_encoding_tracking: the tracking information for the H264/AAC encoding
    :param h265_and_ac3_encoding_tracking: the tracking information for the H265 encoding
    :param vp9_and_vorbis_encoding_tracking: the tracking information for the VP9/Vorbis encoding
    :return: the created DASH manifest
    """
    dash_manifest = _create_dash_manifest(name="stream.mpd", dash_profile=DashProfile.LIVE, output=output,
                                          output_path="")

    period = bitmovin_api.encoding.manifests.dash.periods.create(manifest_id=dash_manifest.id, period=Period())

    video_adaptation_set_vp9 = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet()
    )

    video_adaptation_set_h265 = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet()
    )

    video_adaptation_set_h264 = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet()
    )

    vorbis_audio_adaptationset = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        audio_adaptation_set=AudioAdaptationSet(lang="en"))

    ac3_audio_adaptationset = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        audio_adaptation_set=AudioAdaptationSet(lang="en"))

    aac_audio_adaptationset = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        audio_adaptation_set=AudioAdaptationSet(lang="en"))

    # Add representations to VP9 adaptation set
    # Add VORBIS WEBM muxing to VORBIS audio adaptation set
    _create_dash_webm_representation(
        encoding=vp9_and_vorbis_encoding_tracking.encoding,
        muxing=vp9_and_vorbis_encoding_tracking.vorbis_webm_muxing,
        dash_manifest=dash_manifest,
        period=period,
        segment_path=VORBIS_WEBM_SEGMENTS_PATH,
        adaptation_set_id=vorbis_audio_adaptationset.id
    )

    # Add VP9 WEBM muxing to VP9 adaptation set
    for rendition in vp9_and_vorbis_encoding_tracking.vp9_webm_muxings.keys():
        _create_dash_webm_representation(
            encoding=vp9_and_vorbis_encoding_tracking.encoding,
            muxing=vp9_and_vorbis_encoding_tracking.vp9_webm_muxings[rendition],
            dash_manifest=dash_manifest,
            period=period,
            segment_path=VP9_WEBM_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            adaptation_set_id=video_adaptation_set_vp9.id
        )

    # Add representations to H265 adaptation set
    # Add AC3 FMP4 muxing to AC3 audio adaptation set
    _create_dash_fmp4_representation(
        encoding=h265_and_ac3_encoding_tracking.encoding,
        muxing=h265_and_ac3_encoding_tracking.ac3_fmp4_muxing,
        dash_manifest=dash_manifest,
        period=period,
        segment_path=AC3_FMP4_SEGMENTS_PATH,
        adaptation_set_id=ac3_audio_adaptationset.id
    )

    # Add H265 FMP4 muxing to H265 video adaptation set
    for rendition in h265_and_ac3_encoding_tracking.h265_fmp4_muxings.keys():
        _create_dash_fmp4_representation(
            encoding=h265_and_ac3_encoding_tracking.encoding,
            muxing=h265_and_ac3_encoding_tracking.h265_fmp4_muxings[rendition],
            dash_manifest=dash_manifest,
            period=period,
            segment_path=H265_FMP4_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            adaptation_set_id=video_adaptation_set_h265.id
        )

    # Add representations to H264 adaptation set
    # Add AAC FMP4 muxing to AAC audio adaptation set
    _create_dash_fmp4_representation(
        encoding=h264_and_aac_encoding_tracking.encoding,
        muxing=h264_and_aac_encoding_tracking.aac_fmp4_muxing,
        dash_manifest=dash_manifest,
        period=period,
        segment_path=AAC_FMP4_SEGMENTS_PATH,
        adaptation_set_id=aac_audio_adaptationset.id
    )

    # Add H264 CMAF muxings to H264 video adaptation set
    for rendition in h264_and_aac_encoding_tracking.h264_cmaf_muxings.keys():
        _create_dash_cmaf_representation(
            encoding=h264_and_aac_encoding_tracking.encoding,
            muxing=h264_and_aac_encoding_tracking.h264_cmaf_muxings[rendition],
            dash_manifest=dash_manifest,
            period=period,
            segment_path=H264_CMAF_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            adaptation_set_id=video_adaptation_set_h264.id
        )

    return dash_manifest


def _extend_hls_manifest(output,
                         h264_and_aac_encoding_tracking,
                         h265_and_ac3_encoding_tracking):
    # type: (Output, H264AndAacEncodingTracking, H265AndAc3EncodingTracking) -> HlsManifest
    """
    Creates the HLS manifest master playlist with the different sub playlists

    :param output: the output that should be used
    :param h264_and_aac_encoding_tracking: the tracking information for the H264/AAC encoding
    :param h265_and_ac3_encoding_tracking: the tracking information for the H265 encoding
    :return: the created DASH manifest
    """

    hls_manifest = _create_hls_manifest(
        name="master.m3u8",
        output=output,
        output_path=""
    )

    # Add representations to H265 adaptation set
    _create_audio_media_playlist(
        encoding=h265_and_ac3_encoding_tracking.encoding,
        manifest=hls_manifest,
        audio_muxing=h265_and_ac3_encoding_tracking.ac3_fmp4_muxing,
        audio_stream=h265_and_ac3_encoding_tracking.ac3_audio_stream,
        uri="audio_ac3_fmp4.m3u8",
        segments_path=AC3_FMP4_SEGMENTS_PATH,
        audio_group=HLS_AUDIO_GROUP_AC3_FMP4
    )

    for rendition in h265_and_ac3_encoding_tracking.h265_fmp4_muxings.keys():
        _create_video_media_playlist(
            encoding=h265_and_ac3_encoding_tracking.encoding,
            manifest=hls_manifest,
            video_muxing=h265_and_ac3_encoding_tracking.h265_fmp4_muxings.get(rendition),
            video_stream=h265_and_ac3_encoding_tracking.h265_video_streams.get(rendition),
            uri="video_h265_{}p_{}.m3u8".format(rendition.height, rendition.bitrate),
            segment_path=H265_FMP4_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            audio_group=HLS_AUDIO_GROUP_AC3_FMP4
        )

    # Add representations to H264 adaptation set
    _create_audio_media_playlist(
        encoding=h264_and_aac_encoding_tracking.encoding,
        manifest=hls_manifest,
        audio_muxing=h264_and_aac_encoding_tracking.aac_fmp4_muxing,
        audio_stream=h264_and_aac_encoding_tracking.aac_audio_stream,
        uri="audio_aac_fmp4.m3u8",
        segments_path=AAC_FMP4_SEGMENTS_PATH,
        audio_group=HLS_AUDIO_GROUP_AAC_FMP4
    )

    _create_audio_media_playlist(
        encoding=h264_and_aac_encoding_tracking.encoding,
        manifest=hls_manifest,
        audio_muxing=h264_and_aac_encoding_tracking.aac_ts_muxing,
        audio_stream=h264_and_aac_encoding_tracking.aac_audio_stream,
        uri="audio_aac_ts.m3u8",
        segments_path=AAC_TS_SEGMENTS_PATH,
        audio_group=HLS_AUDIO_GROUP_AAC_TS
    )

    # Add H264 TS muxings to H264 video adaptation set
    for rendition in h264_and_aac_encoding_tracking.h264_ts_muxings.keys():
        _create_video_media_playlist(
            encoding=h264_and_aac_encoding_tracking.encoding,
            manifest=hls_manifest,
            video_muxing=h264_and_aac_encoding_tracking.h264_ts_muxings.get(rendition),
            video_stream=h264_and_aac_encoding_tracking.h264_video_streams.get(rendition),
            uri="video_h264_{}p_{}.m3u8".format(rendition.height, rendition.bitrate),
            segment_path=H264_TS_SEGMENTS_PATH_FORMAT.format(rendition.height, rendition.bitrate),
            audio_group=HLS_AUDIO_GROUP_AAC_TS
        )

    return hls_manifest


def _create_dash_cmaf_representation(encoding, muxing, dash_manifest, period, segment_path, adaptation_set_id):
    # type: (Encoding, CmafMuxing, DashManifest, Period, str, str) -> None
    """
    Creates a DASH CMAF representation

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsCmafByManifestIdAndPeriodIdAndAdaptationsetId

    :param encoding: the encoding where the resources belong to
    :param muxing: the muxing that should be used for this representation
    :param dash_manifest: the dash manifest to which the representation should be added
    :param period: the period to which the representation should be added
    :param segment_path: the path the the CMAF segments
    :param adaptation_set_id: the adaptation set to which the representation should be added
    """

    dash_cmaf_representation = DashCmafRepresentation(
        type_=DashRepresentationType.TEMPLATE,
        encoding_id=encoding.id,
        muxing_id=muxing.id,
        segment_path=segment_path
    )

    bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.cmaf.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        adaptationset_id=adaptation_set_id,
        dash_cmaf_representation=dash_cmaf_representation
    )


def _create_dash_fmp4_representation(encoding, muxing, dash_manifest, period, segment_path, adaptation_set_id):
    # type: (Encoding, CmafMuxing, DashManifest, Period, str, str) -> None
    """
    Creates a DASH FMP4 representation

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    :param encoding: the encoding where the resources belong to
    :param muxing: the muxing that should be used for this representation
    :param dash_manifest: the dash manifest to which the representation should be added
    :param period: the period to which the representation should be added
    :param segment_path: the path the the FMP4 segments
    :param adaptation_set_id: the adaptation set to which the representation should be added
    """

    dash_fmp4_representation = DashFmp4Representation(
        type_=DashRepresentationType.TEMPLATE,
        encoding_id=encoding.id,
        muxing_id=muxing.id,
        segment_path=segment_path
    )

    bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.cmaf.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        adaptationset_id=adaptation_set_id,
        dash_cmaf_representation=dash_fmp4_representation
    )


def _create_dash_webm_representation(encoding, muxing, dash_manifest, period, segment_path, adaptation_set_id):
    # type: (Encoding, CmafMuxing, DashManifest, Period, str, str) -> None
    """
    Creates a DASH WebM representation

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsWebmByManifestIdAndPeriodIdAndAdaptationsetId

    :param encoding: the encoding where the resources belong to
    :param muxing: the muxing that should be used for this representation
    :param dash_manifest: the dash manifest to which the representation should be added
    :param period: the period to which the representation should be added
    :param segment_path: the path the the WebM segments
    :param adaptation_set_id: the adaptation set to which the representation should be added
    """

    dash_webm_representation = DashFmp4Representation(
        type_=DashRepresentationType.TEMPLATE,
        encoding_id=encoding.id,
        muxing_id=muxing.id,
        segment_path=segment_path
    )

    bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.webm.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        adaptationset_id=adaptation_set_id,
        dash_webm_representation=dash_webm_representation
    )


def _create_dash_manifest(name, dash_profile, output, output_path):
    # type: (str, DashProfile, Output, str) -> DashManifest
    """
    Creates a DASH manifest

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash

    :param name: the resource name
    :param dash_profile: the DASH profile of the manifest (ON_DEMAND, LIVE)
    :param output: the output of the manifest
    :param output_path: the output path where the manifest is written to
    :return: the created manifest
    """

    dash_manifest = DashManifest(
        name=name,
        profile=dash_profile,
        outputs=[_build_encoding_output(output=output, output_path=output_path)]
    )

    return bitmovin_api.encoding.manifests.dash.create(dash_manifest=dash_manifest)


def _create_hls_manifest(name, output, output_path):
    # type: (str, Output, str) -> HlsManifest
    """
    Creates a HLS manifest

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash

    :param name: the resource name
    :param output: the output of the manifest
    :param output_path: the output path where the manifest is written to
    :return: the created manifest
    """
    hls_manifest = HlsManifest(
        name=name,
        outputs=[_build_encoding_output(output=output, output_path=output_path)]
    )

    return bitmovin_api.encoding.manifests.hls.create(hls_manifest=hls_manifest)


def _create_audio_media_playlist(encoding,
                                 manifest,
                                 audio_muxing,
                                 audio_stream,
                                 uri,
                                 segments_path,
                                 audio_group):
    # type: (Encoding, HlsManifest, Muxing, Stream, str, str, str) -> None
    """
    Creates an HLS audio media playlist.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaAudioByManifestId

    :param encoding: the encoding where the resources belong to
    :param manifest: the manifest where the audio playlist should be added
    :param audio_muxing: the audio muxing that should be used
    :param audio_stream: the audio stream of the muxing
    :param segments_path: the path to the audio segments
    """

    audio_media_info = AudioMediaInfo(
        name=uri,
        uri=uri,
        group_id=audio_group,
        encoding_id=encoding.id,
        stream_id=audio_stream.id,
        muxing_id=audio_muxing.id,
        language="en",
        assoc_language="en",
        autoselect=False,
        is_default=False,
        forced=False,
        segment_path=segments_path
    )

    bitmovin_api.encoding.manifests.hls.media.audio.create(manifest_id=manifest.id, audio_media_info=audio_media_info)


def _create_video_media_playlist(encoding, manifest, video_muxing, video_stream, uri, segment_path, audio_group):
    # type: (Encoding, HlsManifest, Muxing, Stream, str, str, str) -> None
    """
    Creates an HLS video playlist

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls

    :param encoding: the encoding where the resources belong to
    :param manifest: the master manifest where the video stream playlist should belong to
    :param video_muxing: the muxing that should be used
    :param video_stream: the stream of the muxing
    :param uri: the relative uri of the playlist file that will be generated
    :param segment_path: the path pointing to the respective video segments
    """

    stream_info = StreamInfo(
        uri=uri,
        encoding_id=encoding.id,
        stream_id=video_stream.id,
        muxing_id=video_muxing.id,
        audio=audio_group,
        segment_path=segment_path
    )

    bitmovin_api.encoding.manifests.hls.streams.create(manifest_id=manifest.id, stream_info=stream_info)


def _execute_encoding(encoding):
    # type: (Encoding) -> None
    """
    Starts the actual encoding process and periodically polls its status until it reaches a final state

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId

    <p>Please note that you can also use our webhooks API instead of polling the status. For more
    information consult the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    :param encoding: The encoding to be started
    """

    bitmovin_api.encoding.encodings.start(encoding_id=encoding.id)

    task = _get_encoding_status(encoding_id=encoding.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _get_encoding_status(encoding_id=encoding.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("Encoding failed")

    print("Encoding finished successfully")


def _execute_dash_manifest(dash_manifest):
    # type: (DashManifest) -> None
    """
    Starts the dash manifest generation process and periodically polls its status until it reaches
    a final state

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId

    <p>Please note that you can also use our webhooks API instead of polling the status. For more
    information consult the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    :param dash_manifest: The dash manifest to be started
    """

    bitmovin_api.encoding.manifests.dash.start(manifest_id=dash_manifest.id)

    task = _get_dash_manifest_status(manifest_id=dash_manifest.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _get_dash_manifest_status(manifest_id=dash_manifest.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("DASH manifest failed")

    print("DASH manifest finished successfully")


def _execute_hls_manifest(hls_manifest):
    # type: (HlsManifest) -> None
    """
    Starts the hls manifest generation process and periodically polls its status until it reaches a
    final state

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId

    <p>Please note that you can also use our webhooks API instead of polling the status. For more
    information consult the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    :param hls_manifest: The dash manifest to be started
    """

    bitmovin_api.encoding.manifests.hls.start(manifest_id=hls_manifest.id)

    task = _get_hls_manifest_status(manifest_id=hls_manifest.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _get_hls_manifest_status(manifest_id=hls_manifest.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("HLS manifest failed")

    print("HLS manifest finished successfully")


def _get_encoding_status(encoding_id):
    time.sleep(5)
    task = bitmovin_api.encoding.encodings.status(encoding_id=encoding_id)
    print("Encoding status is {} (progress: {} %)".format(task.status, task.progress))
    return task


def _get_dash_manifest_status(manifest_id):
    time.sleep(5)
    task = bitmovin_api.encoding.manifests.dash.status(manifest_id=manifest_id)
    return task


def _get_hls_manifest_status(manifest_id):
    time.sleep(5)
    task = bitmovin_api.encoding.manifests.hls.status(manifest_id=manifest_id)
    return task


def _create_encoding(name, description):
    # type: (str, str) -> Encoding
    """
    Creates an Encoding object. This is the base object to configure your encoding.

    API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings

    :param name: A name that will help you identify the encoding in our dashboard (required)
    :param description: A description of the encoding (optional)
    """

    encoding = Encoding(
        name=name,
        description=description
    )

    return bitmovin_api.encoding.encodings.create(encoding=encoding)


def _create_http_input(host):
    # type: (str) -> HttpInput
    """
    Creates a resource representing an HTTP server providing the input files. For alternative input methods see
    <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">
    list of supported input and output storages</a>

    For reasons of simplicity, a new input resource is created on each execution of this
    example. In production use, this method should be replaced by a
    <a href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId">
    get call</a> to retrieve an existing resource.

    API endpoint:
        https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp

    :param host: The hostname or IP address of the HTTP server e.g.: my-storage.biz
    """
    http_input = HttpInput(host=host)

    return bitmovin_api.encoding.inputs.http.create(http_input=http_input)


def _create_s3_output(bucket_name, access_key, secret_key):
    # type: (str, str, str) -> S3Output
    """
    Creates a resource representing an AWS S3 cloud storage bucket to which generated content will be transferred.
    For alternative output methods see
    <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">
    list of supported input and output storages</a>

    <p>The provided credentials need to allow <i>read</i>, <i>write</i> and <i>list</i> operations.
    <i>delete</i> should also be granted to allow overwriting of existings files. See <a
    href="https://bitmovin.com/docs/encoding/faqs/how-do-i-create-a-aws-s3-bucket-which-can-be-used-as-output-location">
    creating an S3 bucket and setting permissions</a> for further information

    <p>For reasons of simplicity, a new output resource is created on each execution of this
    example. In production use, this method should be replaced by a
    <a href="https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/GetEncodingOutputsS3">
    get call</a> retrieving an existing resource.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/PostEncodingOutputsS3

    :param bucket_name: The name of the S3 bucket
    :param access_key: The access key of your S3 account
    :param secret_key: The secret key of your S3 account
    """

    s3_output = S3Output(
        bucket_name=bucket_name,
        access_key=access_key,
        secret_key=secret_key
    )

    return bitmovin_api.encoding.outputs.s3.create(s3_output=s3_output)


def _create_h264_video_configuration(height, bitrate):
    # type: (int, int) -> H264VideoConfiguration
    """
    Creates a configuration for the H.264 video codec to be applied to video streams.

    <p>The output resolution is defined by setting the height to 1080 pixels. Width will be
    determined automatically to maintain the aspect ratio of your input video.

    <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
    proven settings for the codec. See <a href=
    "https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">
    how to optimize your H264 codec configuration for different use-cases</a> for alternative presets.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
    """

    config = H264VideoConfiguration(
        name="H.264 {}p".format(height),
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_configuration=config)


def _create_h265_video_configuration(height, bitrate):
    # type: (int, int) -> H265VideoConfiguration
    """
    Creates a basic H.265 video configuration. The width of the video will be set accordingly to the aspect ratio of the
    source video.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
    """

    config = H265VideoConfiguration(
        name="H.265 {}p".format(height),
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h265.create(h265_video_configuration=config)


def _create_stream(encoding, encoding_input, input_path, codec_configuration):
    # type: (Encoding, Input, str, CodecConfiguration) -> Stream
    """
    Adds a video or audio stream to an encoding

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId

    :param encoding: The encoding to which the stream will be added
    :param encoding_input: The input resource providing the input file
    :param input_path: The path to the input file
    :param codec_configuration: The codec configuration to be applied to the stream
    """

    stream_input = StreamInput(
        input_id=encoding_input.id,
        input_path=input_path
    )

    stream = Stream(
        input_streams=[stream_input],
        codec_config_id=codec_configuration.id
    )

    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _create_aac_audio_configuration():
    # type: () -> AacAudioConfiguration
    """
    Creates a configuration for the AAC audio codec to be applied to audio streams.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
    """

    config = AacAudioConfiguration(
        name="AAC 128 kbit/s",
        bitrate=128000
    )

    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_configuration=config)


def _create_ac3_audio_configuration():
    # type: () -> Ac3AudioConfiguration
    """
    Creates an AC3 audio configuration.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAc3
    """

    config = Ac3AudioConfiguration(
        name="AC3 196 kbit/s",
        bitrate=196000,
        channel_layout=Ac3ChannelLayout.CL_5_1
    )

    return bitmovin_api.encoding.configurations.audio.ac3.create(ac3_audio_configuration=config)


def _create_vorbis_audio_configuration():
    # type: () -> VorbisAudioConfiguration
    """
    Creates a Vorbis audio configuration. The sample rate of the audio will be set accordingly to
    the sample rate of the source audio.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioVorbis
    """
    config = VorbisAudioConfiguration(name="Vorbis 128 kbit/s", bitrate=128000)

    return bitmovin_api.encoding.configurations.audio.vorbis.create(vorbis_audio_configuration=config)


def _create_vp9_video_configuration(height, bitrate):
    # type: (int, int) -> Vp9VideoConfiguration
    """
    Creates a base VP9 video configuration. The width of the video will be set accordingly to the
    aspect ratio of the source video.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoVp9
    """

    config = Vp9VideoConfiguration(
        name="VP9 video configuration",
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.vp9.create(vp9_video_configuration=config)


def _create_cmaf_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> CmafMuxing
    """
    Creates a CMAF muxing. This will generate segments with a given segment length for adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsCmafByEncodingId

    :param encoding: The encoding to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragmented segments will be written to
    :param stream: The stream that is associated with the muxing
    """

    muxing_stream = MuxingStream(stream_id=stream.id)

    muxing = CmafMuxing(outputs=[_build_encoding_output(output=output, output_path=output_path)],
                        segment_length=4.0,
                        streams=[muxing_stream])

    return bitmovin_api.encoding.encodings.muxings.cmaf.create(encoding_id=encoding.id, cmaf_muxing=muxing)


def _create_fmp4_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> Fmp4Muxing
    """
    Creates a fragmented TS muxing. This will generate segments with a given segment length for
    adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    :param encoding: The encoding to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragmented segments will be written to
    :param stream: The stream that is associated with the muxing
    """

    muxing_stream = MuxingStream(stream_id=stream.id)

    muxing = Fmp4Muxing(outputs=[_build_encoding_output(output=output, output_path=output_path)],
                        segment_length=4.0,
                        streams=[muxing_stream])

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


def _create_ts_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> TsMuxing
    """
    Creates a fragmented TS muxing. This will generate segments with a given segment length for
    adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    :param encoding: The encoding where to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the segments will be written to
    :param stream: The stream that is associated with the muxing
    """

    muxing_stream = MuxingStream(stream_id=stream.id)

    muxing = TsMuxing(outputs=[_build_encoding_output(output=output, output_path=output_path)],
                      segment_length=4.0,
                      streams=[muxing_stream])

    return bitmovin_api.encoding.encodings.muxings.ts.create(encoding_id=encoding.id, ts_muxing=muxing)


def _create_webm_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> TsMuxing
    """
    Creates a WebM muxing. This will generate segments with a given segment length for adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsWebmByEncodingId

    :param encoding: The encoding where to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the segments will be written to
    :param stream: The stream that is associated with the muxing
    """
    muxing_stream = MuxingStream(stream_id=stream.id)

    muxing = WebmMuxing(outputs=[_build_encoding_output(output=output, output_path=output_path)],
                        segment_length=4.0,
                        streams=[muxing_stream])

    return bitmovin_api.encoding.encodings.muxings.webm.create(encoding_id=encoding.id, webm_muxing=muxing)


def _build_encoding_output(output, output_path):
    # type: (Output, str) -> EncodingOutput
    """
    Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will be written to.
    Public read permissions will be set for the files written, so they can be accessed easily via HTTP.

    :param output: The output resource to be used by the EncodingOutput
    :param output_path: The path where the content will be written to
    """

    acl_entry = AclEntry(
        permission=AclPermission.PUBLIC_READ
    )

    return EncodingOutput(
        output_path=_build_absolute_path(relative_path=output_path),
        output_id=output.id,
        acl=[acl_entry]
    )


def _build_absolute_path(relative_path):
    # type: (str) -> str
    """
    Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
    name of this example and the given relative path

    <p>e.g.: /s3/base/path/exampleName/relative/path

    :param relative_path: The relative path that is concatenated
    """

    return path.join(config_provider.get_s3_output_base_path(), EXAMPLE_NAME, relative_path)


def _log_task_errors(task):
    # type: (Task) -> None

    if task is None:
        return

    filtered = filter(lambda msg: msg.type is MessageType.ERROR, task.messages)

    for message in filtered:
        print(message.text)


main()
