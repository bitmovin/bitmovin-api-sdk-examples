import math

from bitmovin_api_sdk import AacAudioConfiguration, AclEntry, AclPermission, BitmovinApi, BitmovinApiLogger, \
    BitmovinError, DashManifestDefault, DashManifestDefaultVersion, Encoding, EncodingOutput, Fmp4Muxing, \
    H264VideoConfiguration, HlsManifestDefault, HlsManifestDefaultVersion, LiveDashManifest, LiveHlsManifest, \
    MessageType, MuxingStream, PresetConfiguration, S3Output, StartLiveEncodingRequest, Stream, StreamInput, Status

from common import ConfigProvider
from os import path
from time import sleep

"""
This example shows how to configure and start a live encoding using default DASH and HLS
manifests. For more information see: https://bitmovin.com/live-encoding-live-streaming/

<p>The following configuration parameters are expected:

<ul>
  <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
  <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
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

EXAMPLE_NAME = "RtmpLiveEncoding"
stream_key = "myStreamKey"

input_video_width = 1920
input_video_height = 1080
aspect_ratio = input_video_width / input_video_height

max_minutes_to_wait_for_live_encoding_details = 5
max_minutes_to_wait_for_encoding_status = 5

config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME, description="Live encoding with RTMP input")

    rtmp_input = _get_rtmp_input()
    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    h264_video_configuration = _create_h264_video_configuration(height=input_video_height, bitrate=3000000)
    aac_audio_configuration = _create_aac_audio_configuration(bitrate=128000)

    h264_video_stream = _create_stream(
        encoding=encoding,
        encoding_input=rtmp_input,
        input_path="live",
        codec_configuration=h264_video_configuration,
        position=0
    )

    aac_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=rtmp_input,
        input_path="live",
        codec_configuration=aac_audio_configuration,
        position=1
    )

    _create_fmp4_muxing(encoding=encoding,
                        output=output,
                        output_path="video/{0}p".format(h264_video_configuration.height),
                        stream=h264_video_stream)
    _create_fmp4_muxing(encoding=encoding,
                        output=output,
                        output_path="audio/{0}kbs".format(aac_audio_configuration.bitrate / 1000),
                        stream=aac_audio_stream)

    dash_manifest = _generate_dash_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )
    hls_manifest = _generate_hls_manifest(
        encoding=encoding,
        output=output,
        output_path=""
    )

    live_dash_manifest = LiveDashManifest(manifest_id=dash_manifest.id)
    live_hls_manifest = LiveHlsManifest(manifest_id=hls_manifest.id)

    start_live_encoding_request = StartLiveEncodingRequest(
        dash_manifests=[live_dash_manifest],
        hls_manifests=[live_hls_manifest],
        stream_key=stream_key
    )

    _start_live_encoding_and_wait_until_running(encoding=encoding, request=start_live_encoding_request)

    live_encoding = _wait_for_live_encoding_details(encoding=encoding)

    print("Live encoding is up and ready for ingest. RTMP URL: rtmp://{0}/live StreamKey: {1}"
          .format(live_encoding.encoder_ip, live_encoding.stream_key))

    # This will enable you to shut down the live encoding from within your script.
    # In production, it is naturally recommended to stop the encoding by using the Bitmovin dashboard
    # or an independent API call
    # https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStopByEncodingId

    input("Press Enter to shutdown the live encoding...")

    print("Shutting down live encoding.")
    bitmovin_api.encoding.encodings.live.stop(encoding_id=encoding.id)
    _wait_until_encoding_is_in_state(encoding=encoding, expected_status=Status.FINISHED)


def _wait_until_encoding_is_in_state(encoding, expected_status):
    # type: (Encoding, Status) -> None
    """
    Periodically checks the status of the encoding.

    <p>Note: You can also use our webhooks API instead of polling the status. For more information
    checkout the API spec:
    https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId

    :param encoding: The encoding that should have the expected status
    :param expected_status: The expected status the provided encoding should have. See {@link Status}
    """
    check_interval_in_seconds = 5
    max_attempts = max_minutes_to_wait_for_encoding_status * (60 / check_interval_in_seconds)
    attempt = 0

    while attempt < max_attempts:
        task = bitmovin_api.encoding.encodings.status(encoding_id=encoding.id)
        if task.status is expected_status:
            return
        if task.status is Status.ERROR:
            _log_task_errors(task=task)
            raise Exception("Encoding failed")

        print("Encoding status is {0}. Waiting for status {1} ({2} / {3})"
              .format(task.status, expected_status, attempt, max_attempts))

        sleep(check_interval_in_seconds)

        attempt += 1

    raise Exception("Encoding did not switch to state {0} within {1} minutes. Aborting."
                    .format(expected_status, max_minutes_to_wait_for_encoding_status))


def _wait_for_live_encoding_details(encoding):
    # type: (Encoding) -> LiveEncoding
    """
    Tries to get the live details of the encoding. It could take a few minutes until this info is
    available.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsLiveByEncodingId

    :param encoding: The encoding for which the live encoding details should be retrieved
    """

    timeout_interval_seconds = 5
    retries = 0
    max_retries = (60 / timeout_interval_seconds) * max_minutes_to_wait_for_live_encoding_details

    while retries < max_retries:
        try:
            return bitmovin_api.encoding.encodings.live.get(encoding_id=encoding.id)
        except BitmovinError:
            print("Failed to fetch live encoding details. Retrying... {0} / {1}"
                  .format(retries, max_retries))
            retries += 1
            sleep(timeout_interval_seconds)

    raise Exception("Live encoding details could not be fetched after {0} minutes"
                    .format(max_minutes_to_wait_for_live_encoding_details))


def _start_live_encoding_and_wait_until_running(encoding, request):
    # type: (Encoding, StartLiveEncodingRequest) -> None
    """
    This method starts the live encoding

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStartByEncodingId

    :param encoding: The encoding that should be started and checked until it is running
    :param request: The request object that is sent with the start call
    """
    bitmovin_api.encoding.encodings.live.start(encoding_id=encoding.id, start_live_encoding_request=request)
    _wait_until_encoding_is_in_state(encoding=encoding, expected_status=Status.RUNNING)


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


def _get_rtmp_input():
    # type: () -> RtmpInput
    """
    Retrieves the first RTMP input. This is an automatically generated resource and read-only.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsRtmp
    """

    rtmp_inputs = bitmovin_api.encoding.inputs.rtmp.list()
    return rtmp_inputs.items[0]


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
        preset_configuration=PresetConfiguration.LIVE_STANDARD,
        height=height,
        width=math.ceil(aspect_ratio * height),
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_configuration=config)


def _create_stream(encoding, encoding_input, input_path, codec_configuration, position):
    # type: (Encoding, Input, str, CodecConfiguration, int) -> Stream
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
        input_path=input_path,
        position=position
    )

    stream = Stream(
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

    :param encoding: The encoding where to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragmented segments will be written to
    :param stream: The stream that is associated with the muxing
    """

    muxing = Fmp4Muxing(
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        segment_length=4.0,
        streams=[MuxingStream(stream_id=stream.id)]
    )

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


def _create_aac_audio_configuration(bitrate):
    # type: (int) -> AacAudioConfiguration
    """
    Creates a configuration for the AAC audio codec to be applied to audio streams.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac

    :param bitrate: The target bitrate of the output audio
    """

    config = AacAudioConfiguration(
        name="AAC {0} kbit/s".format(bitrate / 1000),
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_configuration=config)


def _generate_hls_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> HlsManifestDefault
    """
    Creates an HLS default manifest that automatically includes all representations configured in
    the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault

    :param encoding: The encoding for which the manifest should be generated
    :param output: The output to which the manifest should be written
    :param output_path: The path to which the manifest should be written
    """

    hls_manifest_default = HlsManifestDefault(
        encoding_id=encoding.id,
        outputs=[_build_encoding_output(output, output_path)],
        name="master.m3u8",
        version=HlsManifestDefaultVersion.V1
    )

    return bitmovin_api.encoding.manifests.hls.default.create(hls_manifest_default=hls_manifest_default)


def _generate_dash_manifest(encoding, output, output_path):
    # type: (Encoding, Output, str) -> DashManifestDefault
    """
    Creates a DASH default manifest that automatically includes all representations configured in
    the encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash

    :param encoding: The encoding for which the manifest should be generated
    :param output: The output to which the manifest should be written
    :param output_path: The path to which the manifest should be written
    """

    dash_manifest_default = DashManifestDefault(
        encoding_id=encoding.id,
        manifest_name="stream.mpd",
        version=DashManifestDefaultVersion.V1,
        outputs=[_build_encoding_output(output, output_path)]
    )

    return bitmovin_api.encoding.manifests.dash.default.create(dash_manifest_default=dash_manifest_default)


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

    return path.join(config_provider.get_s3_output_base_path(), EXAMPLE_NAME + "/", relative_path)


def _log_task_errors(task):
    # type: (Task) -> None

    if task is None:
        return

    filtered = [x for x in task.messages if x.type is MessageType.ERROR]

    for message in filtered:
        print(message.text)


if __name__ == '__main__':
    main()
