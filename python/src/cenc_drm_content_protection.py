import time
from os import path

from bitmovin_api_sdk import AacAudioConfiguration, AclEntry, AclPermission, BitmovinApi, \
    BitmovinApiLogger, CencDrm, CencFairPlay, CencWidevine, CodecConfiguration, DashManifest, \
    DashManifestDefault, DashManifestDefaultVersion, Encoding, EncodingOutput, Fmp4Muxing, \
    H264VideoConfiguration, HlsManifest, HlsManifestDefault, HlsManifestDefaultVersion, HttpInput, \
    Input, ManifestGenerator, ManifestResource, MessageType, Muxing, MuxingStream, Output, \
    PresetConfiguration, S3Output, StartEncodingRequest, Status, Stream, StreamInput, Task

from common import ConfigProvider

"""
 * This example shows how DRM content protection can be applied to a fragmented MP4 muxing. The
 * encryption is configured to be compatible with both FairPlay and Widevine, using the MPEG-CENC
 * standard.
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
 *   <li>DRM_KEY - 16 byte encryption key, represented as 32 hexadecimal characters Example:
 *       cab5b529ae28d5cc5e3e7bc3fd4a544d
 *   <li>DRM_FAIRPLAY_IV - 16 byte initialization vector, represented as 32 hexadecimal characters
 *       Example: 08eecef4b026deec395234d94218273d
 *   <li>DRM_FAIRPLAY_URI - URI of the licensing server Example:
 *       skd://userspecifc?custom=information
 *   <li>DRM_WIDEVINE_KID - 16 byte encryption key id, represented as 32 hexadecimal characters
 *       Example: 08eecef4b026deec395234d94218273d
 *   <li>DRM_WIDEVINE_PSSH - Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg==
 * </ul>
 *
 * <p>Configuration parameters will be retrieved from these sources in the listed order:
 *
 * <ol>
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
 *   <li>properties file located in the root folder of the Python examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
"""

EXAMPLE_NAME = "CencDrmContentProtection"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME,
                                description="Example with CENC DRM content protection")

    http_input = _create_http_input(host=config_provider.get_http_input_host())
    input_file_path = config_provider.get_http_input_file_path()

    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    # Add an H.264 video stream to the encoding
    h264_video_configuration = _create_h264_video_configuration()
    h264_video_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=h264_video_configuration
    )

    # Add an AAC audio stream to the encoding
    aac_audio_configuration = _create_aac_audio_configuration()
    aac_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=aac_audio_configuration
    )

    video_muxing = _create_fmp4_muxing(
        encoding=encoding,
        stream=h264_video_stream
    )

    audio_muxing = _create_fmp4_muxing(
        encoding=encoding,
        stream=aac_audio_stream
    )

    _create_drm_config(
        encoding=encoding,
        muxing=video_muxing,
        output=output,
        output_path="video"
    )

    _create_drm_config(
        encoding=encoding,
        muxing=audio_muxing,
        output=output,
        output_path="audio"
    )

    dash_manifest = _create_default_dash_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )

    hls_manifest = _create_default_hls_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )

    start_encoding_request = StartEncodingRequest(
        manifest_generator=ManifestGenerator.V2,
        vod_dash_manifests=[ManifestResource(manifest_id=dash_manifest.id)],
        vod_hls_manifests=[ManifestResource(manifest_id=hls_manifest.id)]
    )

    _execute_encoding(encoding=encoding, start_encoding_request=start_encoding_request)


def _execute_encoding(encoding, start_encoding_request):
    # type: (Encoding, StartEncodingRequest) -> None
    """
    Starts the actual encoding process and periodically polls its status until it reaches a final state

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId

    <p>Please note that you can also use our webhooks API instead of polling the status. For more
    information consult the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    :param encoding: The encoding to be started
    :param start_encoding_request: The request object to be sent with the start call
    """

    bitmovin_api.encoding.encodings.start(encoding_id=encoding.id,
                                          start_encoding_request=start_encoding_request)

    task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _wait_for_enoding_to_finish(encoding_id=encoding.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("Encoding failed")

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


def _create_h264_video_configuration():
    # type: () -> H264VideoConfiguration
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
    """

    config = H264VideoConfiguration(
        name="H.264 1080p 1.5 Mbit/s",
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=1080,
        bitrate=1500000
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_configuration=config)


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


def _create_fmp4_muxing(encoding, stream):
    # type: (Encoding, Stream) -> Fmp4Muxing
    """
    Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
    adaptive streaming.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
    @param encoding The encoding where to add the muxing to
    @param stream The stream that is associated with the muxing
    """

    muxing = Fmp4Muxing(
        segment_length=4.0,
        streams=[MuxingStream(stream_id=stream.id)]
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id,
                                                               fmp4_muxing=muxing)


def _create_drm_config(encoding, muxing, output, output_path):
    # type: (Encoding, Muxing, Output, str) -> CencDrm
    """
    Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and FairPlay
    specific fields will be included into DASH and HLS manifests to enable key retrieval using
    either DRM method.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId

    :param encoding:
    :param muxing:
    :param output:
    :param output_path:
    :return:
    """

    widevine_drm = CencWidevine(
        pssh=config_provider.get_drm_widevine_pssh()
    )

    cenc_fair_play = CencFairPlay(
        iv=config_provider.get_drm_fairplay_iv(),
        uri=config_provider.get_drm_fairplay_uri()
    )

    cenc_drm = CencDrm(
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        key=config_provider.get_drm_key(),
        kid=config_provider.get_drm_widevine_kid(),
        widevine=widevine_drm,
        fair_play=cenc_fair_play
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.drm.cenc.create(encoding_id=encoding.id,
                                                                        muxing_id=muxing.id,
                                                                        cenc_drm=cenc_drm)


def _create_default_dash_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> DashManifest
    """
    Creates a DASH default manifest that automatically includes all representations configured in
    the encoding.
    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """

    dash_manifest_default = DashManifestDefault(
        encoding_id=encoding.id,
        manifest_name="stream.mpd",
        version=DashManifestDefaultVersion.V1,
        outputs=[_build_encoding_output(output, output_path)]
    )

    return bitmovin_api.encoding.manifests.dash.default.create(
        dash_manifest_default=dash_manifest_default
    )


def _create_default_hls_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> HlsManifest
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
        outputs=[_build_encoding_output(output, output_path)],
        name="master.m3u8",
        manifest_name="master.m3u8",
        version=HlsManifestDefaultVersion.V1
    )

    return bitmovin_api.encoding.manifests.hls.default.create(
        hls_manifest_default=hls_manifest_default)


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

    filtered = [msg for msg in task.messages if msg.type is MessageType.ERROR]

    for message in filtered:
        print(message.text)


if __name__ == '__main__':
    main()
