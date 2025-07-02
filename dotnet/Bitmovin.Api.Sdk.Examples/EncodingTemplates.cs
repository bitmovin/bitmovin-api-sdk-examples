using System;
using System.Linq;
using System.Threading.Tasks;
using Bitmovin.Api.Sdk.Common.Logging;
using Bitmovin.Api.Sdk.Examples.common;
using Bitmovin.Api.Sdk.Models;
using YamlDotNet.Serialization;

namespace Bitmovin.Api.Sdk.Examples
{
    /// <summary>
    /// This example shows how to do a Per-Title encoding with default manifests with Encoding Templates.
    /// For more information see: https://bitmovin.com/per-title-encoding/<para />
    ///
    /// The following configuration parameters are expected:
    /// <list type="bullet">
    /// <item>
    /// <term>BITMOVIN_API_KEY</term>
    /// <description>Your API key for the Bitmovin API</description>
    /// </item>
    /// <item>
    /// <term>BITMOVIN_TENANT_ORG_ID</term>
    /// <description>(optional) The ID of the Organisation in which you want to perform the encoding.</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_FILE_PATH</term>
    /// <description>The path to your input file on the provided HTTP server Example:
    ///     videos/1080p_Sintel.mp4</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_BUCKET_NAME</term>
    /// <description>The name of your S3 output bucket. Example: my-bucket-name</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_ACCESS_KEY</term>
    /// <description>The access key of your S3 output bucket</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_SECRET_KEY</term>
    /// <description>The secret key of your S3 output bucket</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_BASE_PATH</term>
    /// <description>The base path on your S3 output bucket where content will be written.
    /// Example: /outputs</description>
    /// </item>
    /// </list><para />
    ///
    /// Configuration parameters will be retrieved from these sources in the listed order:
    /// <list type="bullet">
    /// <item>
    /// <term>command line arguments</term>
    /// <description>(eg BITMOVIN_API_KEY=xyz)</description>
    /// </item>
    /// <item>
    /// <term>properties file located in the root folder of the C# examples at ./examples.properties</term> 
    /// <description>(see examples.properties.template as reference)</description>
    /// </item>
    /// <item>
    /// <term>environment variables</term>
    /// </item>
    /// <item>
    /// <term>properties file located in the home folder at ~/.bitmovin/examples.properties</term>
    /// <description>(see examples.properties.template as reference)</description>
    /// </item>
    /// </list>
    /// </summary>
    public class EncodingTemplates : IExample
    {
        private ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(args);
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                // uncomment the following line if you are working with a multi-tenant account
                // .WithTenantOrgIdKey(_configProvider.GetBitmovinTenantOrgId())
                .WithLogger(new ConsoleLogger())
                .Build();

            var inputFilePath = _configProvider.GetHttpInputFilePath();
            var outputFilePath = _configProvider.GetS3OutputBasePath();

            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var template = $@"metadata:
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
              inputPath: {inputFilePath}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264
          mode: PER_TITLE_TEMPLATE
      video_h264_1080p:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: {inputFilePath}
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
              - outputId: {output.Id}
                outputPath: {outputFilePath}/vod_streams_encoding/{{width}}_{{bitrate}}_{{uuid}}/
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
              - outputId: {output.Id}
                outputPath: {outputFilePath}/vod_streams_encoding/{{bitrate}}/
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
            autoRepresentations: {}
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
            - outputId: {output.Id}
              outputPath: {outputFilePath}/vod_streams_encoding/
              acl:
                - permission: PRIVATE
          version: V2";

            // await ExecuteEncoding(template);

            var deserializer = new DeserializerBuilder().Build();
            var yaml = deserializer.Deserialize(template);
            await ExecuteEncoding(yaml);
        }

        /// <summary>
        /// Starts the actual encoding process and periodically polls its status until it reaches a final state<para />
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
        /// <br />
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
        /// <para />
        ///
        /// Please note that you can also use our webhooks API instead of polling the status. For more
        /// information consult the API spec:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
        /// </summary>
        /// <param name="template">The Encoding Template to be used for starting an encoding</param>
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteEncoding(object template)
        {
            var result = await _bitmovinApi.Encoding.Templates.StartAsync(template);

            ServiceTaskStatus serviceTaskStatus;
            do
            {
                await Task.Delay(5000);
                serviceTaskStatus = await _bitmovinApi.Encoding.Encodings.StatusAsync(result.EncodingId);
                Console.WriteLine($"Encoding status is {serviceTaskStatus.Status} (progress: {serviceTaskStatus.Progress} %)");
            } while (serviceTaskStatus.Status != Status.FINISHED && serviceTaskStatus.Status != Status.ERROR);

            if (serviceTaskStatus.Status == Status.ERROR)
            {
                LogTaskErrors(serviceTaskStatus);
                throw new SystemException("Encoding failed");
            }

            Console.WriteLine("Encoding finished successfully");
        }

        /// <summary>
        /// Creates a resource representing an AWS S3 cloud storage bucket to which generated content will
        /// be transferred. For alternative output methods see
        /// https://bitmovin.com/docs/encoding/articles/supported-input-output-storages for the list of
        /// supported input and output storages.<para />
        ///
        /// The provided credentials need to allow read, write and list operations.
        /// delete should also be granted to allow overwriting of existing files. See
        /// https://bitmovin.com/docs/encoding/faqs/how-do-i-create-a-aws-s3-bucket-which-can-be-used-as-output-location
        /// for creating an S3 bucket and setting permissions for further information<para />
        ///
        /// For reasons of simplicity, a new output resource is created on each execution of this
        /// example. In production use, this method should be replaced by a get call
        /// (https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/GetEncodingOutputsS3)
        /// retrieving an existing resource.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/PostEncodingOutputsS3
        /// </summary>
        /// <param name="bucketName">The name of the S3 bucket</param> 
        /// <param name="accessKey">The access key of your S3 account</param>
        /// <param name="secretKey">The secret key of your S3 account</param>
        private Task<S3Output> CreateS3Output(string bucketName, string accessKey, string secretKey)
        {
            var s3Output = new S3Output()
            {
                BucketName = bucketName,
                AccessKey = accessKey,
                SecretKey = secretKey
            };

            return _bitmovinApi.Encoding.Outputs.S3.CreateAsync(s3Output);
        }

        /// <summary>
        /// Print all task errors
        /// </summary>
        /// <param name="task">Task with the errors</param>
        private void LogTaskErrors(ServiceTaskStatus task)
        {
            task.Messages.Where(msg => msg.Type == MessageType.ERROR).ToList().ForEach(message =>
            {
                Console.WriteLine(message.Text);
            });
        }
    }
}
