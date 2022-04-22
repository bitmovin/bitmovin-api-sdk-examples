from bitmovin_api_sdk import *
import time
from common import ConfigProvider

"""
This example demonstrates how to execute an encoding using the Bitmovin Content Delivery Network
as output storage.

<p>The following configuration parameters are expected:

<ul>
<li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
<li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
<li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
    e.g.: my-storage.biz
<li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
    videos/1080p_Sintel.mp4
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


config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(
    api_key=config_provider.get_bitmovin_api_key(),
    # uncomment the following line if you are working with a multi-tenant account
    # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
    logger=BitmovinApiLogger()
)


def main():
    encoding = _create_encoding(name='Encoding with CDN Output',
                                description='First encoding with CDN output')

    input = _create_http_input(config_provider.get_http_input_host())
    output = _get_cdn_output()

    h264_video_bitrate_ladder_configurations = [
        _create_h264_video_config(1280, 720, 3000000),
        _create_h264_video_config(1280, 720, 4608000),
        _create_h264_video_config(1920, 1080, 6144000),
        _create_h264_video_config(1920, 1080, 7987200),
    ]

    for video_config in h264_video_bitrate_ladder_configurations:
        video_stream = _create_stream(encoding, input, config_provider.get_http_input_file_path(), video_config)
        _create_fmp4_muxing(encoding, output, f"video/{video_config.bitrate}", video_stream)

    aac_audio_configurations = [
        _create_aac_audio_config(192000),
        _create_aac_audio_config(64000)
    ]

    for audio_config in aac_audio_configurations:
        audio_stream = _create_stream(encoding, input, config_provider.get_http_input_file_path(), audio_config)
        _create_fmp4_muxing(encoding, output, f"audio/${audio_config.bitrate}", audio_stream)

    dash_manifest = _create_default_dash_manifest(encoding, output, '/')
    hls_manifest = _create_default_hls_manifest(encoding, output, '/')

    start_encoding_request = StartEncodingRequest(
        manifest_generator=ManifestGenerator.V2,
        vod_dash_manifests=[_build_manifest_resource(dash_manifest)],
        vod_hls_manifests=[_build_manifest_resource(hls_manifest)]
    )

    _execute_encoding(encoding, start_encoding_request)

    dash_url = _build_cdn_url_for_dash(output, dash_manifest)
    hls_url = _build_cdn_url_for_hls(output, hls_manifest)
    print(dash_url)
    print(hls_url)


def _create_encoding(name: str, description: str) -> Encoding:
    """
    Creates an Encoding object. This is the base object to configure your encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings

    @param name This is the name of the encoding
    @param description This is the description of the encoding
    """
    encoding = Encoding(name=name, description=description, cloud_region=CloudRegion.AWS_EU_WEST_1)
    return bitmovin_api.encoding.encodings.create(encoding=encoding)


def _create_http_input(host: str) -> HttpInput:
    """"
    Creates a resource representing an HTTP server providing the input files. For alternative input
    methods see <a
    href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">list of
    supported input and output storages</a>

    <p>For reasons of simplicity, a new input resource is created on each execution of this
    example. In production use, this method should be replaced by a <a
    href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId">get
    call</a> to retrieve an existing resource.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp

    @param host The hostname or IP address of the HTTP server e.g.: my-storage.biz
    """
    http_input = HttpInput(host=host)
    return bitmovin_api.encoding.inputs.http.create(http_input=http_input)


def _get_cdn_output() -> CdnOutput:
    """
    Retrieves the singleton CdnOutput resource that exists for every organization

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/GetEncodingOutputsCdn
    """
    cdn_outputs = bitmovin_api.encoding.outputs.cdn.list().items

    return cdn_outputs[0]


def _create_aac_audio_config(bitrate: int) -> AacAudioConfiguration:
    """
    Creates a configuration for the AAC audio codec to be applied to audio streams.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac

    @param bitrate The target bitrate for the encoded audio
    """
    aac_audio_config = AacAudioConfiguration(
        name=f'AAC Audio @ {round(bitrate / 1000)} Kbps',
        bitrate=bitrate
    )
    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_config)


def _create_fmp4_muxing(encoding: Encoding, output: Output, output_path: str, stream: Stream) -> Fmp4Muxing:
    """
    Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
    adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    @param encoding The encoding where to add the muxing to
    @param output The output that should be used for the muxing to write the segments to
    @param output_path The output path where the fragmented segments will be written to
    @param stream The stream to be muxed
    """
    muxing_stream = MuxingStream(stream_id=stream.id)
    muxing = Fmp4Muxing(
        outputs=[_build_encoding_output(output, output_path)],
        streams=[muxing_stream],
        segment_length=4.0)

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding.id, muxing)


def _create_stream(encoding: Encoding, input: Input, input_path: str,
                   codec_configuration: CodecConfiguration) -> Stream:
    """
    Create a stream which binds an input file to a codec configuration. The stream is used later
    for muxings.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId

    @param encoding The encoding where to add the stream to
    @param input The input where the input file is located
    @param input_path The path to the input file
    @param codec_configuration The codec configuration to be applied to the stream
    """
    stream_input = StreamInput(input_id=input.id,
                               input_path=input_path,
                               selection_mode=StreamSelectionMode.AUTO)

    stream = Stream(input_streams=[stream_input], codec_config_id=codec_configuration.id)
    return bitmovin_api.encoding.encodings.streams.create(encoding.id, stream)


def _create_default_dash_manifest(encoding: Encoding, output: Output, output_path: str) -> DashManifestDefault:
    """
    Creates a DASH default manifest that automatically includes all representations configured in
    the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashDefault

    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """
    dash_manifest_default = DashManifestDefault(
        encoding_id=encoding.id,
        manifest_name="stream.mpd",
        outputs=[_build_encoding_output(output, output_path)],
        version=DashManifestDefaultVersion.V1
    )

    return bitmovin_api.encoding.manifests.dash.default.create(dash_manifest_default)


def _create_default_hls_manifest(encoding: Encoding, output: Output, output_path: str) -> HlsManifest:
    """
    Creates an HLS default manifest that automatically includes all representations configured in
    the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault

    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """
    hls_manifest_default = HlsManifestDefault(
        encoding_id=encoding.id,
        manifest_name="index.m3u8",
        outputs=[_build_encoding_output(output, output_path)],
        version=HlsManifestDefaultVersion.V1
    )

    return bitmovin_api.encoding.manifests.hls.default.create(hls_manifest_default)


def _build_manifest_resource(manifest: Manifest) -> ManifestResource:
    """
    Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
    StartEncodingRequest manifest lists.

    @param manifest The manifest to be generated at the end of the encoding process
    """
    manifest_resource = ManifestResource(manifest_id=manifest.id)
    return manifest_resource


def _create_h264_video_config(width: int, height: int, bitrate: int) -> H264VideoConfiguration:
    """
    Creates a configuration for the H.264 video codec to be applied to video streams.

    <p>The output resolution is defined by setting the height to 1080 pixels. Width will be
    determined automatically to maintain the aspect ratio of your input video.

    <p>To keep things simple, we use a quality-optimized VoD preset configuration, which will apply
    proven settings for the codec. See <a
    href="https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases">How
    to optimize your H264 codec configuration for different use-cases</a> for alternative presets.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264

    @param width The width of the output video
    @param height The height of the output video
    @param bitrate The target bitrate of the output video
    """
    h264_video_config = H264VideoConfiguration(
        name=f'H.264 {height} {round(bitrate / 1000)} Kbit/s',
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        width=width,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_config)


def _build_encoding_output(output: Output, output_path: str) -> EncodingOutput:
    """
    Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
    be written to.

    @param output The output resource to be used by the EncodingOutput
    @param output_path The path where the content will be written to
    """
    encoding_output = EncodingOutput(
        output_path=output_path,
        output_id=output.id,
    )

    return encoding_output


def _execute_encoding(encoding: Encoding, start_encoding_request: StartEncodingRequest):
    """"
    Starts the actual encoding process and periodically polls its status until it reaches a final
    state

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId

    <p>Please note that you can also use our webhooks API instead of polling the status. For more
    information consult the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    @param encoding The encoding to be started
    @param start_encoding_request The request object to be sent with the start call
    """
    bitmovin_api.encoding.encodings.start(encoding.id, start_encoding_request)

    task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    if task.status == Status.ERROR:
        _log_task_errors(task=task)
        raise RuntimeError("Encoding failed")

    print("Encoding finished successfully")


def _wait_for_enoding_to_finish(encoding_id):
    # type: (str) -> Task
    """
    Waits five second and retrieves afterwards the status of the given encoding id
    :param encoding_id The encoding which should be checked
    """
    time.sleep(5)
    task = bitmovin_api.encoding.encodings.status(encoding_id=encoding_id)
    print("Encoding status is {} (progress: {} %)".format(task.status, task.progress))
    return task


def _build_cdn_url_for_dash(cdn_output: CdnOutput, manifest: DashManifest) -> str:
    """
    Builds an HTTPS URL that points to the manifest output file on the CDN.

    @param manifest  The Manifest for which the CDN URL should be retrieved
    @param cdn_output
    """
    dash_output: EncodingOutput = bitmovin_api.encoding.manifests.dash.get(manifest.id).outputs[0]

    return f"https://{cdn_output.domain_name}/{dash_output.output_path}{manifest.manifest_name}"


def _build_cdn_url_for_hls(cdn_output: CdnOutput, manifest: HlsManifest) -> str:
    """
    Builds an HTTPS URL that points to the manifest output file on the CDN.

    @param manifest  The Manifest for which the CDN URL should be retrieved
    @param cdn_output
    """
    hls_output: EncodingOutput = bitmovin_api.encoding.manifests.hls.get(manifest.id).outputs[0]

    return f"https://{cdn_output.domain_name}/{hls_output.output_path}{manifest.manifest_name}"


def _log_task_errors(task: Task):
    error_messages = filter(lambda msg: Message(msg.type == MessageType.ERROR), task.messages)

    for msg in error_messages:
        print(msg.text)


if __name__ == '__main__':
    main()
