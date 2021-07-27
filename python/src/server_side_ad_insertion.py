import time
from os import path

from bitmovin_api_sdk import AacAudioConfiguration, AclEntry, AclPermission, AudioMediaInfo, \
    BitmovinApi, \
    BitmovinApiLogger, CodecConfiguration, CustomTag, Encoding, EncodingOutput, Fmp4Muxing, \
    H264VideoConfiguration, \
    HlsManifest, \
    HttpInput, Input, Keyframe, ManifestGenerator, ManifestResource, MessageType, Muxing, \
    MuxingStream, \
    Output, PositionMode, \
    PresetConfiguration, S3Output, StartEncodingRequest, Status, Stream, \
    StreamInfo, StreamInput, StreamMode, StreamSelectionMode, Task

from common.config_provider import ConfigProvider

"""
This example demonstrates how to create multiple fMP4 renditions with Server Side Ad Insertion
(SSAI)

<p>The following configuration parameters are expected:

<ul>
    <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
    <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
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

EXAMPLE_NAME = "ServerSideAdInsertion"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME,
                                description="Encoding with SSAI conditioned HLS streams")

    http_input = _create_http_input(host=config_provider.get_http_input_host())
    input_file_path = config_provider.get_http_input_file_path()

    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    video_configurations = [_create_h264_video_configuration(height=1080, bitrate=4800000),
                            _create_h264_video_configuration(height=720, bitrate=2400000),
                            _create_h264_video_configuration(height=480, bitrate=1200000),
                            _create_h264_video_configuration(height=360, bitrate=800000),
                            _create_h264_video_configuration(height=240, bitrate=400000)]

    video_muxings = []

    for video_configuration in video_configurations:
        video_stream = _create_stream(encoding=encoding,
                                      encoding_input=http_input,
                                      input_path=input_file_path,
                                      codec_configuration=video_configuration,
                                      stream_mode=StreamMode.STANDARD)
        output_path = "video/{0}".format(video_configuration.height)
        video_muxing = _create_fmp4_muxing(encoding=encoding,
                                           output=output,
                                           output_path=output_path,
                                           stream=video_stream)
        video_muxings.append(video_muxing)

    aac_audio_configuration = _create_aac_audio_configuration()
    aac_audio_stream = _create_stream(encoding=encoding,
                                      encoding_input=http_input,
                                      input_path=input_file_path,
                                      codec_configuration=aac_audio_configuration,
                                      stream_mode=StreamMode.STANDARD
                                      )
    aac_audio_muxing = _create_fmp4_muxing(encoding=encoding,
                                           output=output,
                                           output_path="audio",
                                           stream=aac_audio_stream)

    # Seconds in which to add a custom HLS tag for ad placement, as well as when to insert a
    # keyframe/split a segment
    ad_break_placements = [5.0, 15.0]

    # define keyframes that are used to insert advertisement tags into the manifest
    keyframes = _create_keyframes(encoding=encoding,
                                  break_placements=ad_break_placements)

    manifest = _create_hls_master_manifest(name="master.m3u8",
                                           output=output,
                                           output_path="")

    audio_media_info = _create_audio_media_playlist(encoding=encoding,
                                                    manifest=manifest,
                                                    audio_muxing=aac_audio_muxing,
                                                    segment_path="audio/")

    _place_audio_advertisment_tags(manifest=manifest, audio_media_info=audio_media_info,
                                   keyframes=keyframes)

    for i in range(0, len(video_muxings)):
        height = video_configurations[i].height
        stream_info = _create_video_stream_playlist(encoding=encoding,
                                                    manifest=manifest,
                                                    file_name="video_{0}.m3u8".format(height),
                                                    muxing=video_muxings[i],
                                                    segment_path="video/{0}".format(height),
                                                    audio_media_info=audio_media_info)
        _place_video_advertisment_tags(manifest=manifest, stream_info=stream_info,
                                       keyframes=keyframes)

    start_encoding_request = StartEncodingRequest(
        manifest_generator=ManifestGenerator.V2,
        vod_hls_manifests=[ManifestResource(manifest_id=manifest.id)]
    )

    _execute_encoding(encoding=encoding, start_encoding_request=start_encoding_request)


def _create_video_stream_playlist(encoding, manifest, file_name, muxing, segment_path,
    audio_media_info):
    # type: (Encoding, HlsManifest, str, Muxing, str, AudioMediaInfo) -> StreamInfo
    """
    Creates an HLS video playlist

    :param encoding: The encoding to which the manifest belongs to
    :param manifest: The manifest to which the playlist should be added
    :param file_name: The file name of the playlist file
    :param muxing: The video muxing for which the playlist should be generated
    :param segment_path: The path containing the video segments to be referenced
    :param audio_media_info: The audio media playlist containing the associated audio group id
    """
    stream_info = StreamInfo(uri=file_name,
                             encoding_id=encoding.id,
                             stream_id=muxing.streams[0].stream_id,
                             muxing_id=muxing.id,
                             audio=audio_media_info.group_id,
                             segment_path=segment_path)

    return bitmovin_api.encoding.manifests.hls.streams.create(manifest_id=manifest.id,
                                                              stream_info=stream_info)


def _place_audio_advertisment_tags(manifest, audio_media_info, keyframes):
    # type: (HlsManifest, AudioMediaInfo, list) -> None
    """
    Adds custom tags for ad-placement to an HLS audio media playlist at given keyframe positions

    :param manifest: The master manifest to which the playlist belongs to
    :param audio_media_info: The audio media playlist to which the tags should be added
    :param keyframes: A list of keyframes specifying the positions where tags will be inserted
    """
    for keyframe in keyframes:
        custom_tag = CustomTag(keyframe_id=keyframe.id,
                               position_mode=PositionMode.KEYFRAME,
                               data="#AD-PLACEMENT-OPPORTUNITY")
        bitmovin_api.encoding.manifests.hls.media.custom_tags.create(manifest_id=manifest.id,
                                                                     media_id=audio_media_info.id,
                                                                     custom_tag=custom_tag)


def _place_video_advertisment_tags(manifest, stream_info, keyframes):
    # type: (HlsManifest, StreamInfo, list) -> None
    """
    Adds custom tags for ad-placement to an HLS video stream playlist at given keyframe positions

    :param manifest: The master manifest to which the playlist belongs to
    :param stream_info: The video stream playlist to which the tags should be added
    :param keyframes: A list of keyframes specifying the positions where tags will be inserted
    """
    for keyframe in keyframes:
        custom_tag = CustomTag(keyframe_id=keyframe.id,
                               position_mode=PositionMode.KEYFRAME,
                               data="#AD-PLACEMENT-OPPORTUNITY")
        bitmovin_api.encoding.manifests.hls.streams.custom_tags.create(manifest_id=manifest.id,
                                                                       stream_id=stream_info.id,
                                                                       custom_tag=custom_tag)


def _create_audio_media_playlist(encoding, manifest, audio_muxing, segment_path):
    # type: (Encoding, HlsManifest, Muxing, str) -> AudioMediaInfo
    """
    Creates an HLS audio media playlist

    :param encoding The encoding to which the manifest belongs to
    :param manifest: The manifest to which the playlist should be added
    :param audio_muxing: The audio muxing for which the playlist should be generated
    :param segment_path: The path containing the audio segments to be referenced by the playlist
    """

    audio_media_info = AudioMediaInfo(name="audio.m3u8",
                                      uri="audio.m3u8",
                                      group_id="audio",
                                      encoding_id=encoding.id,
                                      stream_id=audio_muxing.streams[0].stream_id,
                                      muxing_id=audio_muxing.id,
                                      language="en",
                                      assoc_language="en",
                                      autoselect=False,
                                      is_default=False,
                                      forced=False,
                                      segment_path=segment_path)

    return bitmovin_api.encoding.manifests.hls.media.audio.create(manifest_id=manifest.id,
                                                                  audio_media_info=audio_media_info)


def _create_hls_master_manifest(name, output, output_path):
    # type: (str, Output, str) -> HlsManifest
    """
    Creates the HLS master manifest.

    :param name: The HLS Manifest name
    :param output: The output resource to which the manifest will be written to
    :param output_path: The path where the manifest will be written to
    """
    manifest = HlsManifest(name=name,
                           outputs=[_build_encoding_output(output=output, output_path=output_path)])

    return bitmovin_api.encoding.manifests.hls.create(hls_manifest=manifest)


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


def _create_keyframes(encoding, break_placements):
    # type: (Encoding, list) -> list
    """
    Creates a Keyframe for each entry in the provided list. With segmentCut set to true, the
    written segments will be split at the given point.

    :param break_placements: the list holding points in time where a keyframe should be inserted
    :return: the list of created keyframes
    """
    keyframes = []

    for ad_break in break_placements:
        keyframe = Keyframe(time=ad_break,
                            segment_cut=True)

        keyframes.append(bitmovin_api.encoding.encodings.keyframes.create(encoding_id=encoding.id,
                                                                          keyframe=keyframe))

    return keyframes


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


def _create_stream(encoding, encoding_input, input_path, codec_configuration, stream_mode):
    # type: (Encoding, Input, str, CodecConfiguration, StreamMode) -> Stream
    """
    Adds a video or audio stream to an encoding

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId

    :param encoding: The encoding to which the stream will be added
    :param encoding_input: The input resource providing the input file
    :param input_path: The path to the input file
    :param codec_configuration: The codec configuration to be applied to the stream
    :param stream_mode: The stream mode tells which type of stream this is see {@link StreamMode}
    """

    stream_input = StreamInput(
        input_id=encoding_input.id,
        input_path=input_path,
        selection_mode=StreamSelectionMode.AUTO
    )

    stream = Stream(
        input_streams=[stream_input],
        codec_config_id=codec_configuration.id,
        mode=stream_mode
    )

    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _create_fmp4_muxing(encoding, output, output_path, stream):
    # type: (Encoding, Output, str, Stream) -> Fmp4Muxing
    """
    Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
    adaptive streaming.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId

    :param encoding: The encoding to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragmented segments will be written to
    :param stream: The stream that is associated with the muxing
    """

    muxing = Fmp4Muxing(
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        streams=[MuxingStream(stream_id=stream.id)],
        segment_length=4.0
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id,
                                                               fmp4_muxing=muxing)


def _create_h264_video_configuration(height, bitrate):
    # type: (int, int) -> H264VideoConfiguration
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
    :param height: The height of the output video
    :param bitrate: The target bitrate of the output video
    """

    config = H264VideoConfiguration(
        name="H.264 {0} {1} Mbit/s".format(height, bitrate / (1000 * 1000)),
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_configuration=config)


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

    filtered = [x for x in task.messages if x.type is MessageType.ERROR]

    for message in filtered:
        print(message.text)


if __name__ == '__main__':
    main()
