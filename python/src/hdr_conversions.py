import time

from os import path

from bitmovin_api_sdk import BitmovinApi, BitmovinApiLogger, Encoding, Input, Output, HttpsInput, S3Output, \
    DolbyVisionInputStream, IngestInputStream, StreamSelectionMode, H265VideoConfiguration, ProfileH265, \
    H265DynamicRangeFormat, PresetConfiguration, AacAudioConfiguration, AacChannelLayout, InputStream, \
    CodecConfiguration, CodecConfigType, Stream, StreamInput, Fmp4Muxing, MuxingStream, AclEntry, AclPermission, \
    EncodingOutput, DashManifest, Period, VideoAdaptationSet, AudioAdaptationSet, DashFmp4Representation, \
    DashRepresentationType, HlsManifest, HlsVersion, StreamInfo, AudioMediaInfo, Status, MessageType, Task


from common.config_provider import ConfigProvider, MissingArgumentError

"""
This example demonstrates how to convert dynamic range format between DolbyVision, HDR10, HLG and SDR.
The supported HDR/SDR conversions are following. If targeting output format is either DolbyVision, HDR10 or HLG, this
example adds SDR renditions automatically. This example works only with Bitmovin Encoder version 2.98.0 or later.
  - Input: DolbyVision
    - Output:
      - DolbyVision and SDR
      - HDR10 and SDR
  - Input: HDR10
    - Output:
      - HDR10 and SDR
      - HLG and SDR
  - Input: HLG
    - Output:
      - HLG and SDR
      - HDR10 and SDR
  - Input: SDR
    - Output:
      - HDR10 and SDR
      - HLG and SDR
<p>This example assumes that the audio is stored in a separate file from the video.
<p>The following configuration parameters are expected:
<ul>
  <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
  <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
  <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
      e.g.: my-storage.biz
  <li>HTTP_INPUT_FILE_PATH - The path to your input file.
  <li>HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH - The path to your DolbyVision metadata file. This parameter is
      required only when using DolbyVision input file with a separated sidecar XML metadata file.
  <li>HTTP_INPUT_AUDIO_FILE_PATH - The path to your audio file in case you want to load audio stream from a separate
      input file. If HTTP_INPUT_FILE_PATH has audio track too, you can specify the same path in this parameter.
  <li>HDR_CONVERSION_INPUT_FORMAT - The input HDR format. Either DolbyVision, HDR10, HLG, or SDR can be specified.
      This parameter needs to be matched with the actual HDR format of the input file.
  <li>HDR_CONVERSION_OUTPUT_FORMAT - The output HDR format to be converted from input file.
      Either DolbyVision, HDR10, HLG, or SDR can be specified.
  <li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
  <li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
  <li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
  <li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
</ul>
"""
config_provider = ConfigProvider()
INPUT_FORMAT = config_provider.get_hdr_conversion_input_format()
OUTPUT_FORMAT = config_provider.get_hdr_conversion_output_format()

EXAMPLE_NAME = f"{INPUT_FORMAT}_To_{OUTPUT_FORMAT}"
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


class Rendition:
    def __init__(self, height, bitrate, profile, dynamic_range_format):
        # type: (int, int, ProfileH265, H265DynamicRangeFormat) -> None
        self.height = height
        self.bitrate = bitrate
        self.profile = profile
        self.dynamic_range_format = dynamic_range_format


class RenditionDefinition:
    def __init__(self):
        if INPUT_FORMAT == "DolbyVision":
            if OUTPUT_FORMAT == "DolbyVision":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.DOLBY_VISION
                needs_sdr_conversion = True
            elif OUTPUT_FORMAT == "HDR10":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HDR10
                needs_sdr_conversion = True
            else:
                raise Exception(f"the dynamic range format {OUTPUT_FORMAT} is not supported.")
        elif INPUT_FORMAT == "HDR10":
            if OUTPUT_FORMAT == "HDR10":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HDR10
                needs_sdr_conversion = True
            elif OUTPUT_FORMAT == "HLG":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HLG
                needs_sdr_conversion = True
            else:
                raise Exception(f"the dynamic range format {OUTPUT_FORMAT} is not supported.")
        elif INPUT_FORMAT == "HLG":
            if OUTPUT_FORMAT == "HLG":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HLG
                needs_sdr_conversion = True
            elif OUTPUT_FORMAT == "HDR10":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HDR10
                needs_sdr_conversion = True
            else:
                raise Exception(f"the dynamic range format {OUTPUT_FORMAT} is not supported.")
        elif INPUT_FORMAT == "SDR":
            if OUTPUT_FORMAT == "HDR10":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HDR10
                needs_sdr_conversion = True
            elif OUTPUT_FORMAT == "HLG":
                profile = ProfileH265.MAIN10
                dynamic_range_format = H265DynamicRangeFormat.HLG
                needs_sdr_conversion = True
            elif OUTPUT_FORMAT == "SDR":
                profile = ProfileH265.MAIN
                dynamic_range_format = H265DynamicRangeFormat.SDR
                needs_sdr_conversion = False
            else:
                raise Exception(f"the dynamic range format {OUTPUT_FORMAT} is not supported.")
        else:
            raise Exception(f"the input format {INPUT_FORMAT} is not supported.")

        self.renditions = [
            Rendition(height=360, bitrate=160000, profile=profile, dynamic_range_format=dynamic_range_format),
            Rendition(height=540, bitrate=730000, profile=profile, dynamic_range_format=dynamic_range_format),
            Rendition(height=720, bitrate=2900000, profile=profile, dynamic_range_format=dynamic_range_format),
            Rendition(height=1080, bitrate=5400000, profile=profile, dynamic_range_format=dynamic_range_format),
            Rendition(height=1440, bitrate=9700000, profile=profile, dynamic_range_format=dynamic_range_format),
            Rendition(height=2160, bitrate=13900000, profile=profile, dynamic_range_format=dynamic_range_format)]

        if needs_sdr_conversion is True:
            sdr_renditions = [
                Rendition(height=360, bitrate=145000, profile=ProfileH265.MAIN,
                          dynamic_range_format=H265DynamicRangeFormat.SDR),
                Rendition(height=540, bitrate=600000, profile=ProfileH265.MAIN,
                          dynamic_range_format=H265DynamicRangeFormat.SDR),
                Rendition(height=720, bitrate=2400000, profile=ProfileH265.MAIN,
                          dynamic_range_format=H265DynamicRangeFormat.SDR),
                Rendition(height=1080, bitrate=4500000, profile=ProfileH265.MAIN,
                          dynamic_range_format=H265DynamicRangeFormat.SDR)]
            self.renditions.extend(sdr_renditions)


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME,
                                description=f"Encoding with HDR conversion from {INPUT_FORMAT} to {OUTPUT_FORMAT}")

    https_input = _create_https_input(host=config_provider.get_http_input_host())
    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    video_input_path = config_provider.get_http_input_file_path()
    audio_input_path = config_provider.get_http_audio_file_path()
    if INPUT_FORMAT == "DolbyVision":
        try:
            input_metadata_path = config_provider.get_http_dolby_vision_metadata_file_path()
        except MissingArgumentError:
            input_metadata_path = None  # If None, expect metadata is embedded in the video_input_path.

        video_input_stream = _create_dolby_vision_input_stream(
            encoding=encoding,
            input=https_input,
            dolby_vision_input_path=video_input_path,
            dolby_vision_metadata_path=input_metadata_path
        )
    else:
        video_input_stream = _create_ingest_input_stream(
            encoding=encoding,
            input=https_input,
            input_path=video_input_path
        )

    audio_input_stream = _create_ingest_input_stream(
        encoding=encoding,
        input=https_input,
        input_path=audio_input_path
    )

    _create_h265_and_aac_encoding(
        encoding=encoding,
        video_input_stream=video_input_stream,
        audio_input_stream=audio_input_stream,
        output=output
    )

    _execute_encoding(encoding=encoding)

    dash_manifest = _create_dash_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )

    hls_manifest = _create_hls_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )

    _execute_dash_manifest(dash_manifest=dash_manifest)
    _execute_hls_manifest(hls_manifest=hls_manifest)


def _create_encoding(name, description):
    # type: (str, str) -> Encoding
    """
    Creates an Encoding object. This is the base object to configure your encoding.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
    :param name: A name that will help you identify the encoding in our dashboard (required)
    :param description: A description of the encoding (optional)
    """

    encoding = Encoding(
        name=name,
        description=description
    )

    return bitmovin_api.encoding.encodings.create(encoding=encoding)


def _create_https_input(host):
    # type: (str) -> Input
    """
    Creates a resource representing an HTTPS server providing the input files. For alternative input methods see
    <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">
    list of supported input and output storages</a>
    For reasons of simplicity, a new input resource is created on each execution of this
    example. In production use, this method should be replaced by a
    <a href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpsByInputId">
    get call</a> to retrieve an existing resource.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttps
    :param host: The hostname or IP address of the HTTPS server e.g.: my-storage.biz
    """

    https_input = HttpsInput(host=host)

    return bitmovin_api.encoding.inputs.https.create(https_input=https_input)


def _create_s3_output(bucket_name, access_key, secret_key):
    # type: (str, str, str) -> Output
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


def _create_dolby_vision_input_stream(encoding, input, dolby_vision_input_path, dolby_vision_metadata_path):
    # type: (Encoding, Input, str, str) -> DolbyVisionInputStream
    """
    Creates a DolbyVisionInputStream and adds it to an encoding.
    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsDolbyVisionByEncodingId
    <p>The DolbyVisionInputStream is used to define where a file to read a dolby vision stream from is located.
    :param encoding: The encoding to be started
    :param input: The input resource providing the input file
    :param dolby_vision_input_path: The path to the DolbyVision input file
    :param dolby_vision_metadata_path: The path to the DolbyVision XML metadata file if a sidecar XML is used.
                                       For embedded metadata case, it should be None.
    """

    dolby_vision_input_stream = DolbyVisionInputStream(
        input_id=input.id,
        video_input_path=dolby_vision_input_path,
        metadata_input_path=dolby_vision_metadata_path
    )

    return bitmovin_api.encoding.encodings.input_streams.dolby_vision.create(
        encoding_id=encoding.id,
        dolby_vision_input_stream=dolby_vision_input_stream)


def _create_ingest_input_stream(encoding, input, input_path):
    # type: (Encoding, Input, str) -> IngestInputStream
    """
    Creates an IngestInputStream and adds it to an encoding.
    <p>The IngestInputStream is used to define where a file to read a stream from is located.
    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
    :param encoding: The encoding to be started
    :param input: The input resource providing the input file
    :param input_path: The path to the input file
    :param stream_selection_mode: The algorithm how the stream in the input file will be selected
    :param position: The position of the stream.
    """

    ingest_input_stream = IngestInputStream(
        input_id=input.id,
        input_path=input_path,
        selection_mode=StreamSelectionMode.AUTO
    )

    return bitmovin_api.encoding.encodings.input_streams.ingest.create(
        encoding_id=encoding.id,
        ingest_input_stream=ingest_input_stream)


def _create_h265_and_aac_encoding(encoding, video_input_stream, audio_input_stream, output):
    # type: (Encoding, InputStream, InputStream, Output) -> None
    """
    Creates an encoding with H265 codec/fMP4 muxing and AAC codec/fMP4 muxing
    :param encoding: The encoding to be started
    :param video_input_stream: The video input to be used for the encoding
    :param audio_input_stream: The audio input to be used for the encoding
    :param output: the output that should be used
    """

    rendition_definition = RenditionDefinition()

    for rendition in rendition_definition.renditions:
        video_configuration = _create_h265_video_configuration(
            height=rendition.height,
            bitrate=rendition.bitrate,
            profile=rendition.profile,
            dynamic_range_format=rendition.dynamic_range_format
        )

        if rendition.dynamic_range_format == H265DynamicRangeFormat.DOLBY_VISION or \
                rendition.dynamic_range_format == H265DynamicRangeFormat.HDR10 or \
                rendition.dynamic_range_format == H265DynamicRangeFormat.HLG:
            stream_name = f"H265 HDR stream {rendition.height}p"
        else:
            stream_name = f"H265 SDR stream {rendition.height}p"

        video_stream = _create_stream(
            name=stream_name,
            encoding=encoding,
            input_stream=video_input_stream,
            codec_configuration=video_configuration
        )

        if rendition.dynamic_range_format == H265DynamicRangeFormat.HDR10 or \
                rendition.dynamic_range_format == H265DynamicRangeFormat.DOLBY_VISION or \
                rendition.dynamic_range_format == H265DynamicRangeFormat.HLG:
            output_path = f"video/hdr/{video_configuration.height}p_{video_configuration.bitrate / 1000:.0f}kbps/"
        else:
            output_path = f"video/sdr/{video_configuration.height}p_{video_configuration.bitrate / 1000:.0f}kbps/"

        _create_fmp4_muxing(
            encoding=encoding,
            output=output,
            output_path=output_path,
            stream=video_stream
        )

    aac_config = _create_aac_audio_configuration()

    aac_audio_stream = _create_stream(
        name=f"AAC stream {aac_config.bitrate / 1000:.0f}kbps",
        encoding=encoding,
        input_stream=audio_input_stream,
        codec_configuration=aac_config
    )

    _create_fmp4_muxing(
        encoding=encoding,
        output=output,
        output_path=f"audio/{aac_config.bitrate / 1000:.0f}kbps/",
        stream=aac_audio_stream
    )


def _create_h265_video_configuration(height, bitrate, profile, dynamic_range_format):
    # type: (int, int, ProfileH265, H265DynamicRangeFormat) -> H265VideoConfiguration
    """
    Creates a configuration for the H.265 video codec to be applied to video streams.
    <p>The output resolution is defined by setting the height. Width will be determined automatically to maintain the
    aspect ratio of your input video.
    <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
    proven settings for the codec. See <a href="https://bitmovin.com/docs/encoding/tutorials/h265-presets"> for more
    detail of how the preset configuration is converted to each codec parameter.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
    :param height: The height of the output video
    :param bitrate: The target bitrate of the output video
    :param profile: The target H.265 profile (MAIN or MAIN10) of the output video
    :param profile: The target dynamic range format of the output video
    """

    config = H265VideoConfiguration(
        name=f"H.265 {height}p",
        profile=profile,
        height=height,
        bitrate=bitrate,
        bufsize=bitrate * 2,
        dynamic_range_format=dynamic_range_format,
        preset_configuration=PresetConfiguration.VOD_STANDARD
    )

    return bitmovin_api.encoding.configurations.video.h265.create(h265_video_configuration=config)


def _create_aac_audio_configuration():
    # type: () -> AacAudioConfiguration
    """
    Creates a configuration for the AAC audio codec to be applied to audio streams.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
    """

    config = AacAudioConfiguration(
        name="AAC 128 kbit/s",
        bitrate=128000,
        channel_layout=AacChannelLayout.CL_STEREO
    )

    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_configuration=config)


def _create_stream(name, encoding, input_stream, codec_configuration):
    # type: (str, Encoding, InputStream, CodecConfiguration) -> Stream
    """
    Adds a video or audio stream to an encoding
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
    :param name: A name that will help you identify the stream in our dashboard
    :param encoding: The encoding to which the stream will be added
    :param input_stream: The input stream resource providing the input video or audio
    :param codec_configuration: The codec configuration to be applied to the stream
    """

    stream_input = StreamInput(
        input_stream_id=input_stream.id
    )

    stream = Stream(
        name=name,
        input_streams=[stream_input],
        codec_config_id=codec_configuration.id
    )

    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _create_fmp4_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> Fmp4Muxing
    """
    Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
    adaptive streaming.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    @param encoding The encoding where to add the muxing to
    @param output The output that should be used for the muxing to write the segments to
    @param output_path The output path where the fragmented segments will be written to
    @param stream The stream that is associated with the muxing
    """

    muxing = Fmp4Muxing(
        segment_length=4.0,
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        streams=[MuxingStream(stream_id=stream.id)]
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id,
                                                               fmp4_muxing=muxing)


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

    task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("Encoding failed")

    print("Encoding finished successfully")


def _get_encoding_status(encoding_id):
    time.sleep(5)
    task = bitmovin_api.encoding.encodings.status(encoding_id=encoding_id)
    print(f"Encoding status is {task.status} (progress: {task.progress} %)")
    return task


def _wait_for_enoding_to_finish(encoding_id):
    # type: (str) -> Task
    """
    Waits five second and retrieves afterwards the status of the given encoding id
    :param encoding_id The encoding which should be checked
    """

    time.sleep(5)
    task = bitmovin_api.encoding.encodings.status(encoding_id=encoding_id)
    print(f"Encoding status is {task.status} (progress: {task.progress} %)")
    return task


def _create_dash_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> DashManifest
    """
    Creates a DASH manifest that includes all representations configured in the encoding.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """

    dash_manifest = DashManifest(
        manifest_name='stream.mpd',
        outputs=[_build_encoding_output(output, output_path)],
        name='DASH Manifest')

    dash_manifest = bitmovin_api.encoding.manifests.dash.create(dash_manifest=dash_manifest)

    period = bitmovin_api.encoding.manifests.dash.periods.create(
        manifest_id=dash_manifest.id,
        period=Period())
    video_adaptation_set_hdr = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet())
    video_adaptation_set_sdr = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet())
    audio_adaptation_set = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        audio_adaptation_set=AudioAdaptationSet(lang='en'))

    muxings = bitmovin_api.encoding.encodings.muxings.fmp4.list(encoding_id=encoding.id)
    for muxing in muxings.items:
        stream = bitmovin_api.encoding.encodings.streams.get(encoding_id=encoding.id,
                                                             stream_id=muxing.streams[0].stream_id)
        segment_path = _remove_output_base_path(muxing.outputs[0].output_path)
        codec = bitmovin_api.encoding.configurations.type.get(configuration_id=stream.codec_config_id)
        if codec.type == CodecConfigType.H265:
            codec_info = bitmovin_api.encoding.configurations.video.h265.get(configuration_id=stream.codec_config_id)
            if codec_info.dynamic_range_format == H265DynamicRangeFormat.HDR10 or \
                    codec_info.dynamic_range_format == H265DynamicRangeFormat.DOLBY_VISION or \
                    codec_info.dynamic_range_format == H265DynamicRangeFormat.HLG:
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=video_adaptation_set_hdr.id,
                    dash_fmp4_representation=DashFmp4Representation(
                        type_=DashRepresentationType.TEMPLATE,
                        encoding_id=encoding.id,
                        muxing_id=muxing.id,
                        segment_path=segment_path))
            elif codec_info.dynamic_range_format == H265DynamicRangeFormat.SDR:
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=video_adaptation_set_sdr.id,
                    dash_fmp4_representation=DashFmp4Representation(
                        type_=DashRepresentationType.TEMPLATE,
                        encoding_id=encoding.id,
                        muxing_id=muxing.id,
                        segment_path=segment_path))
        elif codec.type == CodecConfigType.AAC:
            bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                manifest_id=dash_manifest.id,
                period_id=period.id,
                adaptationset_id=audio_adaptation_set.id,
                dash_fmp4_representation=DashFmp4Representation(
                    type_=DashRepresentationType.TEMPLATE,
                    encoding_id=encoding.id,
                    muxing_id=muxing.id,
                    segment_path=segment_path))

    return dash_manifest


def _create_hls_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> HlsManifest
    """
    Creates a HLS manifest that includes all representations configured in the encoding.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """

    hls_manifest = HlsManifest(
        manifest_name='stream.m3u8',
        outputs=[_build_encoding_output(output, output_path)],
        name='HLS Manifest',
        hls_master_playlist_version=HlsVersion.HLS_V8,
        hls_media_playlist_version=HlsVersion.HLS_V8,
    )

    hls_manifest = bitmovin_api.encoding.manifests.hls.create(hls_manifest=hls_manifest)

    muxings = bitmovin_api.encoding.encodings.muxings.fmp4.list(encoding_id=encoding.id)
    for muxing in muxings.items:
        stream = bitmovin_api.encoding.encodings.streams.get(
            encoding_id=encoding.id,
            stream_id=muxing.streams[0].stream_id)
        segment_path = _remove_output_base_path(muxing.outputs[0].output_path)
        codec = bitmovin_api.encoding.configurations.type.get(configuration_id=stream.codec_config_id)
        if codec.type == CodecConfigType.H265:
            codec_info = bitmovin_api.encoding.configurations.video.h265.get(configuration_id=stream.codec_config_id)
            if codec_info.dynamic_range_format == H265DynamicRangeFormat.HDR10 or \
                    codec_info.dynamic_range_format == H265DynamicRangeFormat.DOLBY_VISION or \
                    codec_info.dynamic_range_format == H265DynamicRangeFormat.HLG:
                url = f"stream_hdr_{codec_info.bitrate}.m3u8"
            else:
                url = f"stream_sdr_{codec_info.bitrate}.m3u8"
            bitmovin_api.encoding.manifests.hls.streams.create(
                manifest_id=hls_manifest.id,
                stream_info=StreamInfo(
                    audio='AUDIO',
                    closed_captions='NONE',
                    segment_path="",
                    uri=segment_path + url,
                    encoding_id=encoding.id,
                    stream_id=stream.id,
                    muxing_id=muxing.id,
                    force_video_range_attribute=True,
                    force_frame_rate_attribute=True))
        elif codec.type == CodecConfigType.AAC:
            codec_info = bitmovin_api.encoding.configurations.audio.aac.get(configuration_id=stream.codec_config_id)
            url = f"aac_{codec_info.bitrate}.m3u8"
            bitmovin_api.encoding.manifests.hls.media.audio.create(
                manifest_id=hls_manifest.id,
                audio_media_info=AudioMediaInfo(
                    name='HLS Audio Media',
                    group_id='AUDIO',
                    segment_path="",
                    encoding_id=encoding.id,
                    stream_id=stream.id,
                    muxing_id=muxing.id,
                    language='en',
                    uri=segment_path + url))

    return hls_manifest


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


def _get_dash_manifest_status(manifest_id):
    time.sleep(5)
    task = bitmovin_api.encoding.manifests.dash.status(manifest_id=manifest_id)
    return task


def _get_hls_manifest_status(manifest_id):
    time.sleep(5)
    task = bitmovin_api.encoding.manifests.hls.status(manifest_id=manifest_id)
    return task


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


def _remove_output_base_path(absolute_path):
    # type: (str) -> str
    """
    Create a relative path from an absolute path by removing S3_OUTPUT_BASE_PATH and EXAMPLE_NAME.
    <p>e.g.: input '/s3/base/path/exampleName/relative/path'  output 'relative/path'
    :param absolute_path: The relative path that is concatenated
    """
    if absolute_path.startswith(config_provider.get_s3_output_base_path() + EXAMPLE_NAME):
        return absolute_path[len(config_provider.get_s3_output_base_path() + EXAMPLE_NAME) + 1:]
    return absolute_path


def _log_task_errors(task):
    # type: (Task) -> None
    """
    Logs all task errors
    @param task The task with the error messsages
    """

    if task is None:
        return

    filtered = [x for x in task.messages if x.type is MessageType.ERROR]

    for message in filtered:
        print(message.text)


if __name__ == '__main__':
    main()