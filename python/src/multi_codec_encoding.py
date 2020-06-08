import time

from common.config_provider import ConfigProvider
from os import path

from bitmovin_api_sdk import AacAudioConfiguration, Ac3AudioConfiguration, AclEntry, AclPermission, BitmovinApi, \
    BitmovinApiLogger, CodecConfiguration, Encoding, EncodingOutput, H264VideoConfiguration, H265VideoConfiguration, \
    HttpInput, Input, MessageType, Mp4Muxing, MuxingStream, Output, PresetConfiguration, ProgressiveTsMuxing, \
    S3Output, Status, Stream, StreamInput, Task

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

EXAMPLE_NAME = "MultiCodecEncoding"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(), logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME, description="Encoding with different codecs and muxing types")

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

    # Add an H.265 video stream to the encoding
    h265_video_configuration = _create_h265_video_configuration()
    h265_video_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=h265_video_configuration
    )

    # Add an AAC audio stream to the encoding
    aac_audio_configuration = _create_aac_audio_configuration()
    aac_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=aac_audio_configuration
    )

    # Add an AC3 audio stream to the encoding
    ac3_audio_configuration = _create_ac3_audio_configuration()
    ac3_audio_stream = _create_stream(
        encoding=encoding,
        encoding_input=http_input,
        input_path=input_file_path,
        codec_configuration=ac3_audio_configuration
    )

    # Create an MP4 muxing with the H.264 and AAC streams
    _create_mp4_muxing(
        encoding=encoding,
        output=output,
        output_path="mp4-h264-aac",
        streams=[h264_video_stream, aac_audio_stream],
        file_name="video.mp4"
    )

    # Create an MP4 muxing with the H.265 and AC3 streams
    _create_mp4_muxing(
        encoding=encoding,
        output=output,
        output_path="mp4-h265-ac3",
        streams=[h265_video_stream, ac3_audio_stream],
        file_name="video.mp4"
    )

    # Create a progressive TS muxing with the H.264 and AAC streams
    _create_progressive_ts_muxing(
        encoding=encoding,
        output=output,
        output_path="progressivets-h264-aac",
        streams=[h264_video_stream, aac_audio_stream],
        file_name="video.ts"
    )

    _execute_encoding(encoding=encoding)


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


def _wait_for_enoding_to_finish(encoding_id):
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


def _create_h265_video_configuration():
    # type: () -> H265VideoConfiguration
    """
    Creates a basic H.265 video configuration. The width of the video will be set accordingly to the aspect ratio of the
    source video.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
    """

    config = H265VideoConfiguration(
        name="H.265 1080p 1.5 Mbit/s",
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=1080,
        bitrate=1500000
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
    Creates an AC3 audio configuration. The sample rate of the audio will be set accordingly to the sample rate of the
    source audio.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAc3
    """

    config = Ac3AudioConfiguration(
        name="AC3 128 kbit/s",
        bitrate=128000
    )

    return bitmovin_api.encoding.configurations.audio.ac3.create(ac3_audio_configuration=config)


def _create_mp4_muxing(encoding, output, output_path, streams, file_name):
    # type: (Encoding, Output, str, list, str) -> Mp4Muxing
    """
    Creates an MP4 muxing.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId

    :param encoding: The encoding to add the MP4 muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragments will be written to
    :param streams: A list of streams to be added to the muxing
    :param file_name: The name of the file that will be written to the output
    """

    muxing = Mp4Muxing(
        filename=file_name,
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        streams=[MuxingStream(stream_id=stream.id) for stream in streams]
    )

    return bitmovin_api.encoding.encodings.muxings.mp4.create(encoding_id=encoding.id, mp4_muxing=muxing)


def _create_progressive_ts_muxing(encoding, output, output_path, streams, file_name):
    # type: (Encoding, Output, str, list, str) -> ProgressiveTsMuxing
    """
    Creates an progressive TS muxing.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsTsByEncodingId

    :param encoding: The encoding to add the muxing to
    :param output: The output that should be used for the muxing to write the segments to
    :param output_path: The output path where the fragments will be written to
    :param streams: A list of streams to be added to the muxing
    :param file_name: The name of the file that will be written to the output
    """

    muxing = ProgressiveTsMuxing(
        filename=file_name,
        outputs=[_build_encoding_output(output=output, output_path=output_path)],
        streams=[MuxingStream(stream_id=stream.id) for stream in streams]
    )

    return bitmovin_api.encoding.encodings.muxings.progressive_ts.create(encoding_id=encoding.id,
                                                                         progressive_ts_muxing=muxing)


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
