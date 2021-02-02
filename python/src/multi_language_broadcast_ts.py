import time

from bitmovin_api_sdk import AclEntry, AclPermission, BitmovinApi, BitmovinApiLogger, \
    BroadcastTsAudioInputStreamConfiguration, BroadcastTsMuxing, BroadcastTsMuxingConfiguration, \
    BroadcastTsVideoInputStreamConfiguration, Encoding, EncodingOutput, H264VideoConfiguration, HttpInput, \
    MessageType, Mp2AudioConfiguration, MuxingStream, PresetConfiguration, S3Output, Status, Stream, StreamInput, \
    StreamSelectionMode

from common.config_provider import ConfigProvider
from os import path

"""
This example demonstrates how multiple audio streams can be included in a BroadcastTS muxing

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

EXAMPLE_NAME = "MultiLanguageBroadcastTs"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME, description="BroadcastTS muxing example with multiple audio streams")

    http_input = _create_http_input(host=config_provider.get_http_input_host())
    input_file_path = config_provider.get_http_input_file_path()

    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    h264_video_configuration = _create_h264_video_configuration()
    h264_video_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=h264_video_configuration,
        stream_selection_mode=StreamSelectionMode.VIDEO_RELATIVE,
        position=0
    )

    mp2_audio_configuration = _create_mp2_audio_configuration()

    eng_audio_stream = _create_stream(encoding=encoding,
                                      encoding_input=http_input,
                                      input_path=input_file_path,
                                      codec_configuration=mp2_audio_configuration,
                                      stream_selection_mode=StreamSelectionMode.AUDIO_RELATIVE,
                                      position=0)
    deu_audio_stream = _create_stream(encoding=encoding,
                                      encoding_input=http_input,
                                      input_path=input_file_path,
                                      codec_configuration=mp2_audio_configuration,
                                      stream_selection_mode=StreamSelectionMode.AUDIO_RELATIVE,
                                      position=1)

    audio_streams = {
        "eng": eng_audio_stream,
        "deu": deu_audio_stream
    }

    _create_broadcast_ts_muxing(encoding=encoding,
                                output=output,
                                output_path="",
                                video_stream=h264_video_stream,
                                audio_streams=audio_streams)

    _execute_encoding(encoding=encoding)


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


def _create_stream(encoding, encoding_input, input_path, codec_configuration, stream_selection_mode, position):
    # type: (Encoding, Input, str, CodecConfiguration, StreamSelectionMode, int) -> Stream
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
        selection_mode=stream_selection_mode,
        position=position
    )

    stream = Stream(
        input_streams=[stream_input],
        codec_config_id=codec_configuration.id
    )

    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


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

    status = None

    while status is not Status.FINISHED and status is not Status.ERROR:
        time.sleep(5)
        task, status = _get_encoding_status(encoding_id=encoding.id)
        print("Encoding status is {} (progress: {} %)".format(status, task.progress))

    if status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("Encoding failed")

    print("Encoding finished successfully")


def _get_encoding_status(encoding_id):
    # type: (str) -> tuple

    task = bitmovin_api.encoding.encodings.status(encoding_id=encoding_id)
    return task, task.status


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


def _create_broadcast_ts_muxing(encoding, output, output_path, video_stream, audio_streams):
    # type: (Encoding, Output, str, Stream, dict) -> BroadcastTsMuxing
    """
    Creates a BroadcastTS muxing with one video and multiple audio streams

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsBroadcastTsByEncodingId

    :param encoding: The encoding to which the muxing will be added
    :param output: The output resource to which the unencrypted segments will be written to
    :param output_path: The output path where the unencrypted segments will be written to
    :param video_stream: The video stream to be included in the muxing
    :param audio_streams: A map of audio streams to be included in the muxing, with the key value
                          specifying their language tag
    """

    audio_muxing_streams = []

    for key in audio_streams:
        audio_muxing_streams.append(MuxingStream(stream_id=audio_streams[key].id))

    video_muxing_stream = MuxingStream(stream_id=video_stream.id)

    pid = 2000

    audio_input_stream_configurations = []

    for lang in audio_streams:
        audio_input_stream_configurations.append(
            BroadcastTsAudioInputStreamConfiguration(stream_id=audio_streams[lang].id,
                                                     packet_identifier=pid,
                                                     language=lang))
        pid += 1

    streams = [video_muxing_stream]
    streams.extend(audio_muxing_streams)
    muxing = BroadcastTsMuxing(
        name=EXAMPLE_NAME,
        filename="broadcast.ts",
        segment_length=4.0,
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        streams=streams,
        configuration=BroadcastTsMuxingConfiguration(
            video_streams=[BroadcastTsVideoInputStreamConfiguration(stream_id=video_stream.id)],
            audio_streams=audio_input_stream_configurations
        )
    )

    return bitmovin_api.encoding.encodings.muxings.broadcast_ts.create(encoding_id=encoding.id,
                                                                       broadcast_ts_muxing=muxing)


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


def _create_mp2_audio_configuration():
    # type: () -> Mp2AudioConfiguration
    """
    Creates a configuration for the MP2 audio codec to be applied to audio streams

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioMp2
    """

    config = Mp2AudioConfiguration(
        name="MP2 96 kbit/s",
        bitrate=96000
    )

    return bitmovin_api.encoding.configurations.audio.mp2.create(mp2_audio_configuration=config)


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

    error_messages = [x for x in task.messages if x.type is MessageType.ERROR]

    for message in error_messages:
        print(message.text)


if __name__ == '__main__':
    main()
