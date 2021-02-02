import time

from bitmovin_api_sdk import AacAudioConfiguration, AclEntry, AclPermission, AudioConfiguration, BitmovinApi, \
    BitmovinApiLogger, BitmovinError, Encoding, EncodingListQueryParams, EncodingOutput, Fmp4Muxing, \
    H264VideoConfiguration, HttpInput, MessageType, MuxingStream, PresetConfiguration, RetryHint, S3Output, Status, \
    Stream, StreamInput, StreamSelectionMode, VideoConfiguration

from enum import Enum
from os import path

from common.config_provider import ConfigProvider

"""
This example demonstrates how to efficiently execute a large batch of encodings in parallel. In
order to keep the startup time for each encoding to a minimum, it is advisable to constantly have
some encodings queued. Encodings will therefore be started in a way to maintain a constant queue
size.

<p>The same list of jobs will be executed on each start. In order to continue a batch after
restarting, you will have to extend the JobDispatcher class to use a persistent data store (e.g.
a database)

<p>Be aware that our webhooks API provides a more advanced way to keep track of your encodings
than constantly polling their status. This approach has been chosen solely for reasons of
simplicity.

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
    <li>properties file located in the root folder of the Python examples at ./examples.properties
        (see examples.properties.template as reference)
    <li>environment variables
    <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
        examples.properties.template as reference)
  </ol>
"""

EXAMPLE_NAME = "BatchEncoding"
config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())

"""
The example will strive to always keep this number of encodings in state 'queued'. Make sure
not to choose a size larger than your queue size limit in the Bitmovin platform, otherwise
encoding start calls will fail.
"""
target_queue_size = 3

"""
The maximum number of retries per job, in case the start call or the encoding process is not
successful. However, no retries will be performed after receiving an error that is considered
permanent. Error code 8004 (platform queue limit exceeded) will always be retried.
"""
max_retries = 2


def main():
    http_input = _create_http_input(host=config_provider.get_http_input_host())
    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )

    codec_configs = _create_codec_configs()
    job_dispatcher = JobDispatcher()

    while not job_dispatcher.all_jobs_finished():
        queued_encodings_count = _count_queued_encodings()
        free_slots = target_queue_size - queued_encodings_count

        if free_slots > 0:
            jobs_to_start = job_dispatcher.get_jobs_to_start(free_slots)

            if len(jobs_to_start) > 0:
                print("There are currently {0} encodings queued. Starting {1} more to reach target queue size of {2}"
                      .format(queued_encodings_count, len(jobs_to_start), target_queue_size))

                _start_encodings(jobs_to_start, codec_configs, http_input, output)

            else:
                print("No more jobs to start. Waiting for {0} jobs to finish."
                      .format(len(job_dispatcher.get_started_jobs())))

        else:
            print("There are currently {0} / {1} encodings queued. Waiting for free slots... "
                  .format(queued_encodings_count, target_queue_size))

        time.sleep(10)

        for job in job_dispatcher.get_started_jobs():
            _update_encoding_job(job)
            time.sleep(0.3)

    print("All encoding jobs are finished!")
    job_dispatcher.log_failed_jobs()


def _start_encodings(jobs_to_start, codec_configs, http_input, output):
    # type: (list, list, HttpInput, S3Output) -> None
    """
    This method will start new encodings created from {@link EncodingJob} objects and update the
    started {@link EncodingJob} objects

    @param jobs_to_start The encoding jobs that should be started
    @param codec_configs A list of codec configurations representing the different video- and audio
      renditions to be generated
    @param http_input The input that should be used for that encodings
    @param output The output that should be used for that encodings
    """
    for job in jobs_to_start:
        if not job.encoding_id:
            encoding = _create_and_configure_encoding(
                http_input,
                job.input_file_path,
                codec_configs,
                job.encoding_name,
                output,
                job.output_path
            )
            job.encoding_id = encoding.id

        try:
            bitmovin_api.encoding.encodings.start(job.encoding_id)

            job.status = EncodingJobStatus.STARTED
            print("Encoding {0} ('{1}') has been started.".format(job.encoding_id, job.encoding_name))
        except BitmovinError as err:
            if err.error_code == 8004:
                print("Encoding {0} ('{1}') could not be started "
                      "because your platform limit for queued encodings has been reached. Will retry"
                      .format(job.encoding_id, job.encoding_name))
                return

            job.retry_count += 1

            if job.retry_count > max_retries:
                print("Encoding {0} ('{1}') has reached the maximum number of retries. Giving up"
                      .format(job.encoding_id, job.encoding_name))
                job.status = EncodingJobStatus.GIVEN_UP
                job.error_messages.append("The encoding could not be started: {0}".format(err.message))

        time.sleep(0.3)


def _create_and_configure_encoding(encoding_input, input_path, codec_configs, encoding_name, output, output_path):
    # type: (Input, str, list, str, Output, str) -> Encoding
    """
    Creates an Encoding object and adds a stream and a muxing for each codec configuration to it.
    This creates a fully configured encoding.

    <p>API endpoint:
    https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings

    :param encoding_input The input that should be used for the encoding
    :param input_path The path to the input file which should be used for the encoding
    :param codec_configs A list of codec configurations representing the different video- and audio
      renditions to be generated
    :param encoding_name A name for the encoding
    :param output The output that should be used for the encoding
    :param output_path The path where the content will be written to
    """

    encoding = Encoding(name=encoding_name)

    encoding = bitmovin_api.encoding.encodings.create(encoding=encoding)

    for codec_config in codec_configs:
        stream = _create_stream(
            encoding=encoding,
            encoding_input=encoding_input,
            input_path=input_path,
            codec_configuration=codec_config
        )

        muxing_output_path = output_path

        if isinstance(codec_config, VideoConfiguration):
            muxing_output_path += "/video/{0}".format(codec_config.height)
        elif isinstance(codec_config, AudioConfiguration):
            muxing_output_path += "/audio/{0}".format(codec_config.bitrate / 100)

        _create_fmp4_muxing(encoding=encoding, stream=stream, output=output, output_path=muxing_output_path)

    return encoding


def _update_encoding_job(job):
    # type: (EncodingJob) -> None
    """
    This checks the status of the associated encoding of the encoding job and would update the
    encoding job in the repository.

    @param job The encoding job to update
    """
    task = bitmovin_api.encoding.encodings.status(job.encoding_id)

    if task.status == Status.FINISHED:
        job.status = EncodingJobStatus.SUCCESSFUL

    elif task.status == Status.ERROR:
        if not _is_retryable_error(task):
            print("Encoding {0} ({1}) failed with a permanent error. Giving up."
                  .format(job.encoding_id, job.encoding_name))
            job.status = EncodingJobStatus.GIVEN_UP
            job.error_messages.append(_get_error_messages(task))
            return

        if job.retry_count > max_retries:
            print("Encoding {0} ({1}) has reached the maximum number of retries. Giving up."
                  .format(job.encoding_id, job.encoding_name))
            job.status = EncodingJobStatus.GIVEN_UP
            job.error_messages.append(_get_error_messages(task))
            return

        print("Encoding {0} ({1}) has failed. Will attempt {2} more retries."
              .format(job.encoding_id, job.encoding_name, max_retries - job.retry_count))
        job.retry_count += 1
        job.status = EncodingJobStatus.WAITING


def _is_retryable_error(task):
    # type: (Task) -> bool
    return task.status == Status.ERROR and task.error and task.error.retry_hint is not RetryHint.NO_RETRY


def _get_error_messages(task):
    # type: (Task) -> []
    if not task:
        return []

    return [x.text for x in task.messages if x.type is MessageType.ERROR]


def _count_queued_encodings():
    # type: () -> int
    """
    This method queries the encodings currently in QUEUED state and returns the total result count
    of that query
    """
    queued_encodings = bitmovin_api.encoding.encodings.list(EncodingListQueryParams(status=Status.QUEUED))
    return queued_encodings.total_count


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
        input_path=input_path,
        selection_mode=StreamSelectionMode.AUTO
    )

    stream = Stream(
        input_streams=[stream_input],
        codec_config_id=codec_configuration.id
    )

    return bitmovin_api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


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

    :param height The height of the output video
    :param bitrate The target bitrate of the output video
    """

    config = H264VideoConfiguration(
        name="H.264 {0}".format(height),
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


def _create_codec_configs():
    video_config_480 = _create_h264_video_configuration(480, 800000)
    video_config_720 = _create_h264_video_configuration(720, 1200000)
    video_config_1080 = _create_h264_video_configuration(1080, 2000000)

    audio_config = _create_aac_audio_configuration()

    return [video_config_480, video_config_720, video_config_1080, audio_config]


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

    return bitmovin_api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


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


class JobDispatcher:
    """
     Helper class managing the encodings to be processed in the batch

    <p>NOTE: This is a dummy implementation that will process the same jobs on each execution of
    the example. For production use, we suggest using a persistent data store (eg. a database) to
    save and reload the job list.
    """

    def __init__(self):
        self.encoding_jobs = []
        input_file_path = config_provider.get_http_input_file_path()
        number_of_encodings = 7

        for i in range(1, number_of_encodings):
            encoding_name = "encoding{0}".format(i)
            self.encoding_jobs.append(
                EncodingJob(
                    input_file_path_=input_file_path,
                    output_path_=path.join(input_file_path, encoding_name),
                    encoding_name_=encoding_name
                )
            )

    def get_jobs_to_start(self, limit):
        # type: (int) -> list
        return [job for job in self.encoding_jobs if job.status == EncodingJobStatus.WAITING][:limit]

    def get_started_jobs(self):
        # type: () -> list
        return [job for job in self.encoding_jobs if job.status == EncodingJobStatus.STARTED]

    def all_jobs_finished(self):
        # type: () -> bool
        return len(
            [job for job in self.encoding_jobs if
             job.status == EncodingJobStatus.WAITING or job.status == EncodingJobStatus.STARTED]) == 0

    def log_failed_jobs(self):
        # type: () -> None
        given_up_jobs = [job for job in self.encoding_jobs if job.status == EncodingJobStatus.GIVEN_UP]

        for job in given_up_jobs:
            print("Encoding {0} ({1}) could not be finished successfully: {3}",
                  job.encoding_id, job.encoding_name, job.error_messages)


class EncodingJob:
    """
    Helper class representing a single job in the batch, holding config values and keeping track of
    its status
    """

    def __init__(self, input_file_path_, output_path_, encoding_name_):
        # type: (str, str, str) -> None
        self.input_file_path = input_file_path_
        self.output_path = output_path_
        self.encoding_name = encoding_name_
        self.status = EncodingJobStatus.WAITING
        self.encoding_id = ""
        self.retry_count = 0
        self.error_messages = []


class EncodingJobStatus(Enum):
    WAITING = 0
    STARTED = 1
    SUCCESSFUL = 2
    GIVEN_UP = 3


if __name__ == '__main__':
    main()
