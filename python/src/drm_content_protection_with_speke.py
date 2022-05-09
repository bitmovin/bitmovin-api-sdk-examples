from os import path

from bitmovin_api_sdk import *
import time
from common import ConfigProvider

"""
This example shows how DRM content protection can be applied to a fragmented MP4 muxing.
Acquisition of DRM keys is done by using the SPEKE protocol, and is configured to offer
compatibility with both PlayReady and Widevine on the one hand, using the MPEG-CENC
standard, and with Fairplay on the other hand. Separate outputs are created for both types
of encryption, due to them having different encryption mode. Separate manifests are also created
(DASH for CENC and HLS for FairPlay)

<p>The following configuration parameters are expected:

<ul>
<li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
<li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform
    the encoding.
<li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
    e.g.: my-storage.biz
<li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server Example:
    videos/1080p_Sintel.mp4
<li>S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket. Example: my-bucket-name
<li>S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
<li>S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
<li>S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
    Example: /outputs
<li>DRM_CONTENT_ID - (optional) The content ID that identifies your content within the SPEKE provider
<li>DRM_KEY_ID - (optional) An additional 16-byte hex key ID that could be needed for some use cases
<li>DRM_FAIRPLAY_IV - The initialisation vector for the FairPlay encryption configuration
<li>SPEKE_URL - The URL of the SPEKE server.
    Example: https://my-speke-server.com/v1.0/vod
</ul>

In addition, you need the following parameters to access the SPEKE server:

<ul>
  <li>For authentication with AWS IAM:
    <ul>
      <li>SPEKE_ARN  -  The role ARN allowing access to the SPEKE server</li>
      <li>SPEKE_GATEWAY_REGION  -  The region of the associated AWS Gateway</li>
    </ul>
  </li>
  <li>For basic authentication:
    <ul>
      <li>SPEKE_USERNAME  -  The username to access the SPEKE server</li>
      <li>SPEKE_PASSWORD  -  The password to access the SPEKE server</li>
    </ul>
  </li>
</ul>

<p>Configuration parameters will be retrieved from these sources in the listed order:

<ol>
<li>command line arguments (eg BITMOVIN_API_KEY=xyz)
<li>properties file located in the root folder of the JAVA examples at ./examples.properties
    (see examples.properties.template as reference)
<li>environment variables
<li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
    examples.properties.template as reference)
    <li>DRM_CONTENT_ID - (optional) The content ID that identifies your content within the SPEKE provider
<li>DRM_KEY_ID - (optional) An additional 16-byte hex key ID that could be needed for some use cases
<li>DRM_FAIRPLAY_IV - The initialisation vector for the FairPlay encryption configuration
<li>SPEKE_URL - The URL of the SPEKE server.
    Example: https://my-speke-server.com/v1.0/vod
</ol>

"""

config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(
    api_key=config_provider.get_bitmovin_api_key(),
    # uncomment the following line if you are working with a multi-tenant account
    # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
    logger=BitmovinApiLogger()
)

EXAMPLE_NAME = "drm_content_protection_with_speke"

WIDEVINE_SYSTEM_ID = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed'
PLAYREADY_SYSTEM_ID = '9a04f079-9840-4286-ab92-e65be0885f95'
FAIRPLAY_SYSTEM_ID = '94ce86fb-07ff-4f43-adb8-93d2fa968ca2'


def main():
    encoding = _create_encoding(name='SPEKE DRM protection on fMP4 muxings',
                                description='Example with CENC and Fairplay DRM content protection using SPEKE')

    http_input = _create_http_input(config_provider.get_http_input_host())
    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key())

    h264_video_configuration = _create_h264_video_configuration()
    aac_audio_configuration = _create_aac_audio_config()

    h264_video_stream = _create_stream(
        encoding=encoding,
        input=http_input,
        input_path=config_provider.get_http_input_file_path(),
        codec_configuration=h264_video_configuration
    )

    aac_audio_stream = _create_stream(
        encoding=encoding,
        input=http_input,
        input_path=config_provider.get_http_input_file_path(),
        codec_configuration=aac_audio_configuration
    )

    video_muxing = _create_base_fmp4_muxing(
        encoding=encoding,
        stream=h264_video_stream
    )
    audio_muxing = _create_base_fmp4_muxing(
        encoding=encoding,
        stream=aac_audio_stream
    )

    _create_fmp4_speke_drm(
        encoding=encoding,
        muxing=video_muxing,
        output=output,
        output_path="video/cenc",
        system_ids=[WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID]
    )
    _create_fmp4_speke_drm(
        encoding=encoding,
        muxing=audio_muxing,
        output=output,
        output_path="audio/cenc",
        system_ids=[WIDEVINE_SYSTEM_ID, PLAYREADY_SYSTEM_ID]
    )

    _create_fmp4_speke_drm(
        encoding=encoding,
        muxing=video_muxing,
        output=output,
        output_path="video/fairplay",
        system_ids=[FAIRPLAY_SYSTEM_ID]
    )
    _create_fmp4_speke_drm(
        encoding=encoding,
        muxing=audio_muxing,
        output=output,
        output_path="audio/fairplay",
        system_ids=[FAIRPLAY_SYSTEM_ID]
    )

    dash_manifest = _create_dash_manifest(
        encoding=encoding,
        output=output,
        output_path='/'
    )
    hls_manifest = _create_hls_manifest(
        encoding=encoding,
        output=output,
        output_path='/'
    )

    start_encoding_request = StartEncodingRequest(
        manifest_generator=ManifestGenerator.V2,
        vod_dash_manifests=[_build_manifest_resource(dash_manifest)],
        vod_hls_manifests=[_build_manifest_resource(hls_manifest)]
    )

    _execute_encoding(
        encoding=encoding,
        start_encoding_request=start_encoding_request
    )


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


def _create_aac_audio_config() -> AacAudioConfiguration:
    """
    Creates a configuration for the AAC audio codec to be applied to audio streams.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
    """
    aac_audio_config = AacAudioConfiguration(
        name='AAC 128 kbit/s',
        bitrate=128000
    )
    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_configuration=aac_audio_config)


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

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


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
    stream_input = StreamInput(
        input_id=input.id,
        input_path=input_path,
        selection_mode=StreamSelectionMode.AUTO
    )

    stream = Stream(input_streams=[stream_input], codec_config_id=codec_configuration.id, mode=StreamMode.STANDARD)
    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _create_base_fmp4_muxing(encoding: Encoding, stream: Stream):
    """
    Creates a fragmented MP4 muxing. This will split the output into continuously numbered segments
    of a given length for adaptive streaming. However, the unencrypted segments will not be written
    to a permanent storage as there's no output defined for the muxing. Instead, an output needs to
    be defined for the DRM configuration resource which will later be added to this muxing.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    @param encoding The encoding where to add the muxing to
    @param stream The stream to be muxed
    """
    muxing_stream = MuxingStream(stream_id=stream.id)
    muxing = Fmp4Muxing(
        streams=[muxing_stream],
        segment_length=4.0
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


def _create_fmp4_speke_drm(encoding: Encoding, muxing: Muxing, output: Output, output_path: str, system_ids: list):
    """
    Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and PlayReady
    specific fields will be included into DASH and HLS manifests to enable key retrieval using
    either DRM method. Encryption information is acquired from a DRM server using the SPEKE protocol

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId

    @param encoding The encoding to which the muxing belongs to
    @param muxing The muxing to apply the encryption to
    @param output The output resource to which the encrypted segments will be written to
    @param output_path The output path where the encrypted segments will be written to
    @param system_ids The list of DRM System IDs to encrypt with
    """
    provider = SpekeDrmProvider(url=config_provider.get_speke_url())

    if config_provider.has_paramater_by_key('SPEKE_ARN'):
        provider.role_arn = config_provider.get_speke_arn()
        provider.gateway_region = config_provider.get_speke_gateway()
    else:
        provider.username = config_provider.get_speke_username()
        provider.password = config_provider.get_speke_password()

    drm = SpekeDrm(
        provider=provider,
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        system_ids=system_ids
    )
    if config_provider.has_paramater_by_key('DRM_CONTENT_ID'):
        drm.content_id = config_provider.get_drm_content_id()
    if config_provider.has_paramater_by_key('DRM_KEY_ID'):
        drm.content_id = config_provider.get_drm_key_id()

    if FAIRPLAY_SYSTEM_ID in system_ids:
        drm.iv = config_provider.get_drm_fairplay_iv()

    return bitmovin_api.encoding.encodings.muxings.fmp4.drm.speke.create(
        encoding_id=encoding.id,
        muxing_id=muxing.id,
        speke_drm=drm
    )


def _create_dash_manifest(encoding: Encoding, output: Output, output_path: str) -> DashManifestDefault:
    """
    Creates a DASH manifest that includes all representations configured in the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash

    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """
    dash_manifest = DashManifest(
        name="DASH manfiest with CENC DRM",
        manifest_name="stream.mpd",
        outputs=[_build_encoding_output(output=output, output_path=output_path)]
    )
    dash_manifest = bitmovin_api.encoding.manifests.dash.create(dash_manifest=dash_manifest)

    period = bitmovin_api.encoding.manifests.dash.periods.create(manifest_id=dash_manifest.id, period=Period())

    video_adaptation_set = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.video.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        video_adaptation_set=VideoAdaptationSet()
    )
    audio_adaptation_set = bitmovin_api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=dash_manifest.id,
        period_id=period.id,
        audio_adaptation_set=AudioAdaptationSet()
    )

    fmp4_muxings = bitmovin_api.encoding.encodings.muxings.fmp4.list(encoding_id=encoding.id).items
    for fmp4_muxing in fmp4_muxings:
        speke_drms = bitmovin_api.encoding.encodings.muxings.fmp4.drm.speke.list(
            encoding_id=encoding.id,
            muxing_id=fmp4_muxing.id
        ).items
        for speke_drm in speke_drms:
            if WIDEVINE_SYSTEM_ID not in speke_drm.system_ids:
                continue

            stream = bitmovin_api.encoding.encodings.streams.get(
                encoding_id=encoding.id,
                stream_id=fmp4_muxing.streams[0].stream_id
            )
            segment_path = _remove_output_base_path(absolute_path=speke_drm.outputs[0].output_path)

            representation = DashFmp4Representation(
                encoding_id=encoding.id,
                muxing_id=fmp4_muxing.id,
                segment_path=segment_path,
                type_=DashRepresentationType.TEMPLATE
            )

            content_protection = ContentProtection(
                encoding_id=encoding.id,
                muxing_id=fmp4_muxing.id,
                drm_id=speke_drm.id
            )

            codec = bitmovin_api.encoding.configurations.type.get(configuration_id=stream.codec_config_id)

            if codec == CodecConfigType.H264:
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=video_adaptation_set.id,
                    dash_fmp4_representation=representation
                )
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.contentprotection.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=video_adaptation_set.id,
                    content_protection=content_protection
                )
            elif codec == CodecConfigType.AAC:
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=audio_adaptation_set.id,
                    dash_fmp4_representation=representation
                )
                bitmovin_api.encoding.manifests.dash.periods.adaptationsets.contentprotection.create(
                    manifest_id=dash_manifest.id,
                    period_id=period.id,
                    adaptationset_id=audio_adaptation_set.id,
                    content_protection=content_protection
                )

    return bitmovin_api.encoding.manifests.dash.create(dash_manifest=dash_manifest)


def _create_hls_manifest(encoding: Encoding, output: Output, output_path: str) -> HlsManifest:
    """
    Creates an HLS manifest that includes all representations configured in the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls

    @param encoding The encoding for which the manifest should be generated
    @param output The output to which the manifest should be written
    @param output_path The path to which the manifest should be written
    """
    hls_manifest = HlsManifest(
        name="HLS manfiest with CENC DRM",
        manifest_name="main.m3u8",
        outputs=[_build_encoding_output(output=output, output_path=output_path)]
    )
    hls_manifest = bitmovin_api.encoding.manifests.hls.create(hls_manifest=hls_manifest)

    fmp4_muxings = bitmovin_api.encoding.encodings.muxings.fmp4.list(encoding_id=encoding.id).items
    for i in range(0, len(fmp4_muxings)):
        fmp4_muxing = fmp4_muxings[i]

        speke_drms = bitmovin_api.encoding.encodings.muxings.fmp4.drm.speke.list(
            encoding_id=encoding.id,
            muxing_id=fmp4_muxing.id
        ).items
        for speke_drm in speke_drms:
            if FAIRPLAY_SYSTEM_ID not in speke_drm.system_ids:
                continue

            stream = bitmovin_api.encoding.encodings.streams.get(
                encoding_id=encoding.id,
                stream_id=fmp4_muxing.streams[0].stream_id
            )
            segment_path = _remove_output_base_path(absolute_path=speke_drm.outputs[0].output_path)

            codec = bitmovin_api.encoding.configurations.type.get(configuration_id=stream.codec_config_id)

            if codec == CodecConfigType.H264:
                stream_info = StreamInfo(
                    encoding_id=encoding.id,
                    muxing_id=fmp4_muxing.id,
                    stream_id=stream.id,
                    drm_id=speke_drm.id,
                    audio_="audio",
                    segment_path=segment_path,
                    uri=f"video_{i}.m3u8",
                )
                bitmovin_api.encoding.manifests.hls.streams.create(manifest_id=hls_manifest.id, stream_info=stream_info)
            elif codec == CodecConfigType.AAC:
                audio_media_info = AudioMediaInfo(
                    name="audio",
                    encoding_id=encoding.id,
                    muxing_id=fmp4_muxing.id,
                    stream_id=stream.id,
                    drm_id=speke_drm.id,
                    group_id="audio",
                    language="en",
                    segment_path=segment_path,
                    uri=f"audio_{i}.m3u8",
                )
                bitmovin_api.encoding.manifests.hls.media.audio.create(
                    manifest_id=hls_manifest.id,
                    audio_media_info=audio_media_info
                )

    return bitmovin_api.encoding.manifests.hls.create(hls_manifest=hls_manifest)


def _build_manifest_resource(manifest: Manifest) -> ManifestResource:
    """
    Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
    StartEncodingRequest manifest lists.

    @param manifest The manifest to be generated at the end of the encoding process
    """
    manifest_resource = ManifestResource(manifest_id=manifest.id)
    return manifest_resource


def _create_h264_video_configuration() -> H264VideoConfiguration:
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
    h264_video_config = H264VideoConfiguration(
        name='H.264 1080p 1.5 Mbit/s',
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=1080,
        bitrate=1500000
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_config)


def _build_encoding_output(output: Output, output_path: str) -> EncodingOutput:
    """
    Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
    be written to. Public read permissions will be set for the files written, so they can be
    accessed easily via HTTP.

    @param output The output resource to be used by the EncodingOutput
    @param output_path The path where the content will be written to
    """
    acl_entry = AclEntry(permission=AclPermission.PUBLIC_READ)

    encoding_output = EncodingOutput(
        output_path=output_path,
        output_id=output.id,
        acl=[acl_entry]
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
    bitmovin_api.encoding.encodings.start(encoding_id=encoding.id, start_encoding_request=start_encoding_request)

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


def _remove_output_base_path(absolute_path: str):
    """
    Creates a relative path from an absolute path, suitable for insertion into a manifest

    <p>e.g.: input '/s3/base/path/exampleName/relative/path' ->  output 'relative/path'</p>

    @param absolute_path - The path to convert into a relative one
    """
    base_path = _build_absolute_path("/") + "/"
    if absolute_path.startswith(base_path):
        return absolute_path[len(base_path) + 1:]
    return absolute_path


def _build_absolute_path(relative_path: str):
    """
    Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
    name of this example and the given relative path
    <p>e.g.: /s3/base/path/exampleName/relative/path
    :param relative_path: The relative path that is concatenated
    """

    return path.join(config_provider.get_s3_output_base_path(), EXAMPLE_NAME, relative_path)


def _log_task_errors(task: Task):
    error_messages = filter(lambda msg: Message(msg.type == MessageType.ERROR), task.messages)

    for msg in error_messages:
        print(msg.text)


if __name__ == '__main__':
    main()
