import time

from bitmovin_api_sdk import AacAudioConfiguration, AclEntry, AclPermission, BitmovinApi, BitmovinApiLogger, Encoding, \
    EncodingOutput, H264VideoConfiguration, HttpsInput, MessageType, Mp4Muxing, MuxingStream, PresetConfiguration, \
    S3Output, Status, Stream, StreamInput, IngestInputStream, TimeBasedTrimmingInputStream, StreamSelectionMode, \
    Task, Input, CodecConfiguration, Output, AacChannelLayout, ConcatenationInputConfiguration, ConcatenationInputStream

from os import path

from common import ConfigProvider


"""
This example demonstrates how to use concatenation and trimming to combine multiple input files into a single output.
This script is the full version of the script documented in the tutorial on concatenation and trimming
    https://bitmovin.com/docs/encoding/tutorials/stitching-and-trimming-part-1-the-basics

<p>The following configuration parameters are expected:

<ul>
  <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
  <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
  <li>HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files,
      e.g.: my-storage.biz
  <li>HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server
      Example: videos/1080p_Sintel.mp4
  <li>HTTP_INPUT_BUMPER_FILE_PATH - The path to your input file on the provided HTTP server to be concatenated before
      HTTP_INPUT_FILE_PATH
      Example: videos/bumper.mp4
  <li>HTTP_INPUT_PROMO_FILE_PATH - The path to your input file on the provided HTTP server to be concatenated after
      HTTP_INPUT_FILE_PATH
      Example: videos/promo.mp4
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

EXAMPLE_NAME = "ConcatenationMultipleInputs"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    encoding = _create_encoding(name=EXAMPLE_NAME,
                                description="Encoding with a concatenation in MP4 muxing")

    https_input = _create_https_input(host=config_provider.get_http_input_host())
    main_file_path = config_provider.get_http_input_file_path()
    bumper_file_path = config_provider.get_http_input_bumper_file_path()
    promo_file_path = config_provider.get_http_input_promo_file_path()

    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    # Define a video and audio stream as an IngestInputStream to represent each input file (main, bumper, and promo)
    main = _create_ingest_input_stream(
        encoding=encoding,
        input=https_input,
        input_path=main_file_path,
        stream_selection_mode=StreamSelectionMode.AUTO
    )
    bumper = _create_ingest_input_stream(
        encoding=encoding,
        input=https_input,
        input_path=bumper_file_path,
        stream_selection_mode=StreamSelectionMode.AUTO
    )
    promo = _create_ingest_input_stream(
        encoding=encoding,
        input=https_input,
        input_path=promo_file_path,
        stream_selection_mode=StreamSelectionMode.AUTO
    )

    # In this example, we trim the main input file and create two separated streams as TimeBasedTrimmingInputStream
    main_part_1 = _create_time_based_trimming_input_stream(
        encoding=encoding,
        ingest_input_stream=main,
        offset=10.0,
        duration=90.0
    )
    main_part_2 = _create_time_based_trimming_input_stream(
        encoding=encoding,
        ingest_input_stream=main,
        offset=100.0,
        duration=60.0
    )

    # Define each concatenation input configuration with "is_main" flag and "position" setting
    # And create a concatenation input stream for the main part 1 and 2 together with bumper and promo
    bumper_config = ConcatenationInputConfiguration(
        input_stream_id=bumper.id,
        is_main=False,
        position=0
    )
    part_1_config = ConcatenationInputConfiguration(
        input_stream_id=main_part_1.id,
        is_main=True,
        position=1
    )
    promo_1_config = ConcatenationInputConfiguration(
        input_stream_id=promo.id,
        is_main=False,
        position=2
    )
    part_2_config = ConcatenationInputConfiguration(
        input_stream_id=main_part_2.id,
        is_main=False,
        position=3
    )
    promo_2_config = ConcatenationInputConfiguration(
        input_stream_id=promo.id,
        is_main=False,
        position=4
    )
    all_together = _create_concatenation_input_stream(
        encoding=encoding,
        concatenation_inputs=[
            bumper_config,
            part_1_config,
            promo_1_config,
            part_2_config,
            promo_2_config
        ]
    )

    # Create an audio codec configuration and the stream.
    # In this sample, we use AAC with 128kbps as a pre-defined audio codec
    aac_audio_configuration = _create_aac_audio_configuration()
    aac_audio_stream = _create_stream_with_concatenation_input_stream(
        encoding=encoding,
        concatenation_input_stream=all_together,
        codec_configuration=aac_audio_configuration
    )

    # Create a video codec configuration and the stream.
    video_configurations = [
        _create_h264_video_configuration(
            height=1080,
            bitrate=4800000)
    ]
    for video_configuration in video_configurations:
        video_stream = _create_stream_with_concatenation_input_stream(
            encoding=encoding,
            concatenation_input_stream=all_together,
            codec_configuration=video_configuration)
        _create_mp4_muxing(encoding=encoding,
                           output=output,
                           output_path="multiple-inputs-concatenation-mp4",
                           streams=[video_stream, aac_audio_stream],
                           file_name="video.mp4")

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

    task = _wait_for_encoding_to_finish(encoding_id=encoding.id)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _wait_for_encoding_to_finish(encoding_id=encoding.id)

    if task.status is Status.ERROR:
        _log_task_errors(task=task)
        raise Exception("Encoding failed")

    print("Encoding finished successfully")


def _wait_for_encoding_to_finish(encoding_id):
    # type: (str) -> Task
    """
    Waits five second and retrieves afterwards the status of the given encoding id
    :param encoding_id: The encoding which should be checked
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


def _create_https_input(host):
    # type: (str) -> HttpsInput
    """
    Creates a resource representing an HTTPS server providing the input files. For alternative input methods see
    <a href="https://bitmovin.com/docs/encoding/articles/supported-input-output-storages">
    list of supported input and output storages</a>

    For reasons of simplicity, a new input resource is created on each execution of this
    example. In production use, this method should be replaced by a
    <a href="https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpsByInputId">
    get call</a> to retrieve an existing resource.

    API endpoint:
        https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttps

    :param host: The hostname or IP address of the HTTPS server e.g.: my-storage.biz
    """
    https_input = HttpsInput(host=host)

    return bitmovin_api.encoding.inputs.https.create(https_input=https_input)


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


def _create_ingest_input_stream(encoding, input, input_path, stream_selection_mode):
    # type: (Encoding, Input, str, StreamSelectionMode) -> IngestInputStream
    """
    Creates an IngestInputStream and adds it to an encoding.
    The IngestInputStream is used to define where a file to read a stream from is located.

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId

    :param encoding: The encoding to be started
    :param input: The input resource providing the input file
    :param input_path: The path to the input file
    :param stream_selection_mode: The algorithm how the stream in the input file will be selected
    """

    ingest_input_stream = IngestInputStream(
        input_id=input.id,
        input_path=input_path,
        selection_mode=stream_selection_mode
    )

    return bitmovin_api.encoding.encodings.input_streams.ingest.create(
        encoding_id=encoding.id,
        ingest_input_stream=ingest_input_stream)


def _create_time_based_trimming_input_stream(encoding, ingest_input_stream, offset, duration):
    # type: (Encoding, IngestInputStream, float, float) -> TimeBasedTrimmingInputStream
    """
    Creates a TimeBasedTrimmingInputStream and adds it to an encoding.
    The TimeBasedTrimmingInputStream is used to define a section of an IngestInputStream using an offset and a duration
    expressed in seconds.

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsTrimmingTimeBasedByEncodingId

    :param encoding: The encoding to be started
    :param ingest_input_stream: The IngestInputStream instance created from the input file
    :param offset: Defines the offset in seconds at which the encoding should start, beginning at 0.
    :param duration: Defines how many seconds of the input will be encoded.
    """

    time_based_trimming_input_stream = TimeBasedTrimmingInputStream(
        input_stream_id=ingest_input_stream.id,
        offset=offset,
        duration=duration
    )

    return bitmovin_api.encoding.encodings.input_streams.trimming.time_based.create(
        encoding_id=encoding.id,
        time_based_trimming_input_stream=time_based_trimming_input_stream)


def _create_concatenation_input_stream(encoding, concatenation_inputs):
    # type: (Encoding, list[ConcatenationInputConfiguration]) -> ConcatenationInputStream
    """
    Creates a ConcatenationInputStream and adds it to an encoding.
    The ConcatenationInputStream is used to define a concatenated stream from multiple input files

    <p>API endpoints:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsConcatenationByEncodingId

    :param encoding: The encoding to be started
    :param concatenation_inputs:  List of ConcatenationInputConfiguration which include each concatenation configuration
    """
    return bitmovin_api.encoding.encodings.input_streams.concatenation.create(
        encoding_id=encoding.id,
        concatenation_input_stream=ConcatenationInputStream(
            concatenation=concatenation_inputs
        )
    )


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
        name="H.264 {0}p".format(height),
        preset_configuration=PresetConfiguration.VOD_STANDARD,
        height=height,
        bitrate=bitrate
    )

    return bitmovin_api.encoding.configurations.video.h264.create(h264_video_configuration=config)


def _create_stream_with_concatenation_input_stream(encoding, concatenation_input_stream, codec_configuration):
    # type: (Encoding, ConcatenationInputStream, CodecConfiguration) -> Stream
    """
    Adds an audio mix input stream to an encoding

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId

    :param encoding: The encoding to which the stream will be added
    :param concatenation_input_stream: The input resource providing the input file
    :param codec_configuration: The codec configuration to be applied to the stream
    """

    stream_input = StreamInput(
        input_stream_id=concatenation_input_stream.id
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
        bitrate=128000,
        channel_layout=AacChannelLayout.CL_5_1_BACK
    )

    return bitmovin_api.encoding.configurations.audio.aac.create(aac_audio_configuration=config)


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
