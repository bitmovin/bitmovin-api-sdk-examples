import time, yaml

from bitmovin_api_sdk import BitmovinApi, BitmovinApiLogger, EncodingTemplateRequest, MessageType, S3Output, Status, Task

from common.config_provider import ConfigProvider

"""
This example shows how to do a Per-Title encoding with default manifests with Encoding Templates.
For more information see: https://bitmovin.com/per-title-encoding/

<p>The following configuration parameters are expected:

  <ul>
    <li>BITMOVIN_API_KEY - Your API key for the Bitmovin API
    <li>BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
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

config_provider = ConfigProvider()
bitmovin_api = BitmovinApi(api_key=config_provider.get_bitmovin_api_key(),
                           # uncomment the following line if you are working with a multi-tenant account
                           # tenant_org_id=config_provider.get_bitmovin_tenant_org_id(),
                           logger=BitmovinApiLogger())


def main():
    input_file_path = config_provider.get_http_input_file_path()
    output_file_path = config_provider.get_s3_output_base_path()

    output = _create_s3_output(
        bucket_name=config_provider.get_s3_output_bucket_name(),
        access_key=config_provider.get_s3_output_access_key(),
        secret_key=config_provider.get_s3_output_secret_key()
    )
    
    template = f"""metadata:
  type: VOD
  name: Standard VOD Workflow

inputs:
  https:
    streams_encoding_https_input:
      properties:
        host: bitmovin-sample-content.s3.eu-west-1.amazonaws.com
        name: Bitmovin Sample Content

configurations:
  video:
    h264:
      streams_encoding_h264:
        properties:
          name: streams_encoding_h264
          profile: MAIN
      streams_encoding_h264_1080p:
        properties:
          name: streams_encoding_h264_1080p
          profile: MAIN
          height: 1080

encodings:
  main-encoding:
    properties:
      name: Standard VOD Workflow
      encoderVersion: STABLE

    streams:
      video_h264:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: {input_file_path}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264
          mode: PER_TITLE_TEMPLATE
      video_h264_1080p:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: {input_file_path}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264_1080p
          mode: PER_TITLE_TEMPLATE_FIXED_RESOLUTION

    muxings:
      fmp4:
        fmp4_h264:
          properties:
            name: fmp4_h264
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264
            outputs:
              - outputId: {output.id}
                outputPath: {output_file_path}/vod_streams_encoding/{{width}}_{{bitrate}}_{{uuid}}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s
        fmp4_h264_1080p:
          properties:
            name: fmp4_h264_1080p
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264_1080p
            outputs:
              - outputId: {output.id}
                outputPath: {output_file_path}/vod_streams_encoding/{{bitrate}}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s

    start:
      properties:
        encodingMode: THREE_PASS
        perTitle:
          h264Configuration:
            targetQualityCrf: 25
        previewDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash
        vodDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash

manifests:
  dash:
    defaultapi:
      default-dash:
        properties:
          encodingId: $/encodings/main-encoding
          name: Template encoding default DASH manifest
          manifestName: manifest.mpd
          profile: ON_DEMAND
          outputs:
            - outputId: {output.id}
              outputPath: {output_file_path}/vod_streams_encoding/
              acl:
                - permission: PRIVATE
          version: V2"""

    yaml_template = yaml.load(template, Loader=yaml.SafeLoader)
    
    # Execute the encoding
    _execute_encoding(template=yaml_template)


def _execute_encoding(template):
    # type: (EncodingTemplateRequest) -> None
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

    encoding = bitmovin_api.encoding.templates.start(template)

    task = _wait_for_enoding_to_finish(encoding_id=encoding.encodingId)

    while task.status is not Status.FINISHED and task.status is not Status.ERROR:
        task = _wait_for_enoding_to_finish(encoding_id=encoding.encodingId)

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
