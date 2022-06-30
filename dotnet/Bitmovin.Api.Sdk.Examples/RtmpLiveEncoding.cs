using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Bitmovin.Api.Sdk.Common;
using Bitmovin.Api.Sdk.Common.Logging;
using Bitmovin.Api.Sdk.Examples.common;
using Bitmovin.Api.Sdk.Models;
using Stream = Bitmovin.Api.Sdk.Models.Stream;
using LiveAutoShutdownConfiguration = Bitmovin.Api.Sdk.Models.LiveAutoShutdownConfiguration;

namespace Bitmovin.Api.Sdk.Examples
{
    /// <summary>
    /// This example shows how to configure and start a live encoding using default DASH and HLS manifests.
    /// For more information see: https://bitmovin.com/live-encoding-live-streaming/<para />
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
    public class RtmpLiveEncoding : IExample
    {
        private ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;
        private const string StreamKey = "myStreamKey";

        /*
         * Make sure to set the correct resolution of your input video, so the aspect ratio can be calculated.
         */
        private const int InputVideoHeight = 1080;
        private const int InputVideoWidth = 1920;
        private const double AspectRatio = (double) InputVideoWidth / InputVideoHeight;

        private const int MaxMinutesWaitingForLiveEncodingDetails = 5;
        private const int MaxMinutesWaitingForEncodingStatus = 5;

        /*
         * Automatically shutdown the live stream if there is no input anymore for a predefined number of seconds.
         */
        private const long BytesReadTimeoutSeconds = 3600; // 1 hour

        /*
         * Automatically shutdown the live stream after a predefined runtime in minutes.
         */
        private const long StreamTimeoutMinutes = 12 * 60; // 12 hours

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(args);
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                // uncomment the following line if you are working with a multi-tenant account
                // .WithTenantOrgIdKey(_configProvider.GetBitmovinTenantOrgId())
                .WithLogger(new ConsoleLogger())
                .Build();

            var encoding = await CreateEncoding("Live encoding example", "Live encoding with RTMP input");

            var input = await GetRtmpInput();
            var inputFilePath = "live";

            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            // Add an H.264 video stream to the encoding
            var h264VideoConfig = await CreateH264VideoConfiguration();
            var h264VideoStream = await CreateStream(encoding, input, inputFilePath, h264VideoConfig);

            // Add an AAC audio stream to the encoding
            var aacConfig = await CreateAacAudioConfiguration();
            var aacAudioStream = await CreateStream(encoding, input, inputFilePath, aacConfig);

            await CreateFmp4Muxing(encoding, output, $"/video/${h264VideoConfig.Height}p", h264VideoStream);
            await CreateFmp4Muxing(encoding, output, $"/audio/${aacConfig.Bitrate! / 1000}kbps", aacAudioStream);

            var dashManifest = await CreateDefaultDashManifest(encoding, output, "/");
            var hlsManifest = await CreateDefaultHlsManifest(encoding, output, "/");

            var liveDashManifest = new LiveDashManifest()
            {
                ManifestId = dashManifest.Id
            };

            var liveHlsManifest = new LiveHlsManifest()
            {
                ManifestId = hlsManifest.Id
            };

            /*
             * Setting the autoShutdownConfiguration is optional,
             * if omitted the live encoding will not shut down automatically.
             */
            var liveAutoShutdownConfiguration = new LiveAutoShutdownConfiguration()
            {
                BytesReadTimeoutSeconds = BytesReadTimeoutSeconds,
                StreamTimeoutMinutes = StreamTimeoutMinutes
            };

            var startLiveEncodingRequest = new StartLiveEncodingRequest()
            {
                DashManifests = new List<LiveDashManifest>() {liveDashManifest},
                HlsManifests = new List<LiveHlsManifest>() {liveHlsManifest},
                AutoShutdownConfiguration = liveAutoShutdownConfiguration,
                StreamKey = StreamKey
            };

            await StartLiveEncodingAndWaitUntilRunning(encoding, startLiveEncodingRequest);
            var liveEncoding = await WaitForLiveEncodingDetails(encoding);

            Console.WriteLine("Live encoding is up and ready for ingest. " +
                              $"RTMP URL: rtmp://{liveEncoding.EncoderIp}/live StreamKey: {liveEncoding.StreamKey}");

            /*
            * This will enable you to shut down the live encoding from within your script.
            * In production, it is naturally recommended to stop the encoding by using the Bitmovin dashboard
            * or an independent API call - https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStopByEncodingId
            */
            Console.WriteLine("Press any key to shutdown the live encoding...");
            Console.ReadKey();

            Console.WriteLine("Shutting down live encoding.");
            await _bitmovinApi.Encoding.Encodings.Live.StopAsync(encoding.Id);
            await WaitUntilEncodingIsInState(encoding, Status.FINISHED);
        }

        /// <summary>
        /// This method starts the live encoding<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsLiveStartByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding that should be started and checked until it is running</param>
        /// <param name="startLiveEncodingRequest">The request object that is sent with the start call</param>
        private async Task StartLiveEncodingAndWaitUntilRunning(Models.Encoding encoding,
            StartLiveEncodingRequest startLiveEncodingRequest)
        {
            await _bitmovinApi.Encoding.Encodings.Live.StartAsync(encoding.Id, startLiveEncodingRequest);
            await WaitUntilEncodingIsInState(encoding, Status.RUNNING);
        }

        /// <summary>
        /// Tries to get the live details of the encoding. It could take a few minutes until this info is available.
        /// <para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsLiveByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding for which the live encoding details should be retrieved</param>
        /// <exception cref="SystemException"></exception>
        private async Task<LiveEncoding> WaitForLiveEncodingDetails(Models.Encoding encoding)
        {
            Console.WriteLine(
                $"Waiting until live encodings are available (max {MaxMinutesWaitingForLiveEncodingDetails} minutes) ...");

            var checkIntervalInSeconds = 10;
            var maxAttempts = MaxMinutesWaitingForLiveEncodingDetails * (60 / checkIntervalInSeconds);
            var attempt = 0;

            BitmovinApiException bitmovinApiException;
            do
            {
                try
                {
                    return await _bitmovinApi.Encoding.Encodings.Live.GetAsync(encoding.Id);
                }
                catch (BitmovinApiException ex)
                {
                    bitmovinApiException = ex;
                    await Task.Delay(checkIntervalInSeconds * 1000);
                }
            } while (attempt++ < maxAttempts);

            throw new SystemException("Failed to retrieve live encoding details withing " +
                                      $"{MaxMinutesWaitingForLiveEncodingDetails} minutes. Aborting.",
                bitmovinApiException);
        }

        /// <summary>
        /// Periodically checks the status of the encoding.<para />
        ///
        /// Note: You can also use our webhooks API instead of polling the status. For more information checkout
        /// the API spec:<br />
        /// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding that should have the expected status</param>
        /// <param name="expectedStatus">The expected status the provided encoding should have. See {@link Status}</param>
        /// <exception cref="SystemException"></exception>
        private async Task WaitUntilEncodingIsInState(Models.Encoding encoding, Status expectedStatus)
        {
            Console.WriteLine($"Waiting for encoding to have status {expectedStatus} " +
                              $"(max {MaxMinutesWaitingForEncodingStatus} minutes) ...");

            var checkIntervalInSeconds = 10;
            var maxAttempts = MaxMinutesWaitingForEncodingStatus * (60 / checkIntervalInSeconds);
            var attempt = 0;

            do
            {
                var serviceTaskStatus = await _bitmovinApi.Encoding.Encodings.StatusAsync(encoding.Id);

                Console.WriteLine($"Encoding with id {encoding.Id} has status: {serviceTaskStatus.Status}");

                if (serviceTaskStatus.Status == Status.ERROR)
                {
                    throw new SystemException(
                        $@"Error while waiting for encoding with ID {encoding.Id} to have the status {expectedStatus}");
                }

                if (serviceTaskStatus.Status == expectedStatus)
                {
                    return;
                }

                await Task.Delay(checkIntervalInSeconds * 1000);
            } while (attempt++ < maxAttempts);

            throw new SystemException($"Live encoding did not switch to state {expectedStatus} within " +
                                      $"{MaxMinutesWaitingForEncodingStatus}. Aborting");
        }

        /// <summary>
        /// Creates a DASH default manifest that automatically includes all representations configured in
        /// the encoding.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashDefault
        /// </summary>
        /// <param name="encoding">The encoding for which the manifest should be generated</param>
        /// <param name="output">The output where the manifest should be written to</param>
        /// <param name="outputPath">The path to which the manifest should be written</param>
        private Task<DashManifestDefault> CreateDefaultDashManifest(Models.Encoding encoding, Output output,
            string outputPath)
        {
            var dashManifestDefault = new DashManifestDefault()
            {
                EncodingId = encoding.Id,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                ManifestName = "stream.mpd",
                Version = DashManifestDefaultVersion.V1
            };

            return _bitmovinApi.Encoding.Manifests.Dash.Default.CreateAsync(dashManifestDefault);
        }

        /// <summary>
        /// Creates a HLS default manifest that automatically includes all representations configured in
        /// the encoding.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
        /// </summary>
        /// <param name="encoding">The encoding for which the manifest should be generated</param>
        /// <param name="output">The output where the manifest should be written to</param>
        /// <param name="outputPath">The path to which the manifest should be written</param>
        private Task<HlsManifestDefault> CreateDefaultHlsManifest(Models.Encoding encoding, Output output,
            string outputPath)
        {
            var hlsManifestDefault = new HlsManifestDefault()
            {
                EncodingId = encoding.Id,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Name = "master.m3u8",
                Version = HlsManifestDefaultVersion.V1
            };

            return _bitmovinApi.Encoding.Manifests.Hls.Default.CreateAsync(hlsManifestDefault);
        }

        /// <summary>
        /// Retrieves the first RTMP input. This is an automatically generated resource and read-only.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsRtmp
        /// </summary>
        private async Task<RtmpInput> GetRtmpInput()
        {
            return (await _bitmovinApi.Encoding.Inputs.Rtmp.ListAsync()).Items.ElementAt(0);
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
        /// Creates an Encoding object. This is the base object to configure your encoding.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
        /// </summary>
        /// <param name="name">This is the name of the encoding</param>
        /// <param name="description">This is the description of the encoding</param>
        private Task<Models.Encoding> CreateEncoding(string name, string description)
        {
            var encoding = new Models.Encoding()
            {
                Name = name,
                Description = description
            };

            return _bitmovinApi.Encoding.Encodings.CreateAsync(encoding);
        }

        /// <summary>
        /// Creates a stream which binds an input file to a codec configuration.
        /// The stream is used for muxings later on.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the stream onto</param>
        /// <param name="input">The input that should be used</param>
        /// <param name="inputPath">The path to the input file</param>
        /// <param name="configuration">The codec configuration to be applied to the stream</param>
        private Task<Stream> CreateStream(Models.Encoding encoding, Input input, string inputPath,
            CodecConfiguration configuration)
        {
            var streamInput = new StreamInput()
            {
                InputId = input.Id,
                InputPath = inputPath,
                SelectionMode = StreamSelectionMode.AUTO
            };

            var stream = new Stream()
            {
                InputStreams = new List<StreamInput>() {streamInput},
                CodecConfigId = configuration.Id
            };

            return _bitmovinApi.Encoding.Encodings.Streams.CreateAsync(encoding.Id, stream);
        }

        /// <summary>
        /// Creates a configuration for the H.264 video codec to be applied to video streams.<para />
        ///
        /// The output resolution is defined by setting the height to 1080 pixels. Width will be determined
        /// automatically to maintain the aspect ratio of your input video.<para />
        ///
        /// To keep things simple, we use a quality-optimized VoD preset configuration, which will apply proven settings
        /// for the codec. See How to optimize your H264 codec configuration for different use-cases
        /// (https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases)
        /// for alternative presets.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
        /// </summary>
        private Task<H264VideoConfiguration> CreateH264VideoConfiguration()
        {
            var config = new H264VideoConfiguration()
            {
                Name = "H.264 1080p 3 Mbit/s",
                PresetConfiguration = PresetConfiguration.LIVE_STANDARD,
                Height = InputVideoHeight,
                Width = (int) Math.Ceiling(AspectRatio * InputVideoHeight),
                Bitrate = 3000000
            };

            return _bitmovinApi.Encoding.Configurations.Video.H264.CreateAsync(config);
        }

        /// <summary>
        /// Creates a configuration for the AAC audio codec to be applied to audio streams.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
        /// </summary>
        private Task<AacAudioConfiguration> CreateAacAudioConfiguration()
        {
            var config = new AacAudioConfiguration()
            {
                Name = "AAC 128 kbit/s",
                Bitrate = 128_000L
            };

            return _bitmovinApi.Encoding.Configurations.Audio.Aac.CreateAsync(config);
        }

        /// <summary>
        /// Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
        /// adaptive streaming.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding where to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragmented segments will be written to</param>
        /// <param name="stream">The stream to be muxed</param>
        private Task<Fmp4Muxing> CreateFmp4Muxing(Models.Encoding encoding, Output output, string outputPath,
            Stream stream)
        {
            var muxingStream = new MuxingStream()
            {
                StreamId = stream.Id
            };

            var muxing = new Fmp4Muxing()
            {
                SegmentLength = 4,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingStream}
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Fmp4.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
        /// be written to. Public read permissions will be set for the files written, so they can be
        /// accessed easily via HTTP.
        /// </summary>
        /// <param name="output">The output resource to be used by the EncodingOutput</param>
        /// <param name="outputPath">The path where the content will be written to</param>
        private EncodingOutput BuildEncodingOutput(Output output, string outputPath)
        {
            var aclEntry = new AclEntry()
            {
                Permission = AclPermission.PUBLIC_READ
            };

            var encodingOutput = new EncodingOutput()
            {
                OutputPath = BuildAbsolutePath(outputPath),
                OutputId = output.Id,
                Acl = new List<AclEntry>() {aclEntry}
            };

            return encodingOutput;
        }

        /// <summary>
        /// Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
        /// name of this example class and the given relative path<para />
        /// 
        /// e.g.: /s3/base/path/ClassName/relative/path
        /// </summary>
        /// <param name="relativePath">The relative path that is concatenated</param>
        private string BuildAbsolutePath(string relativePath)
        {
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(RtmpLiveEncoding), relativePath);
        }
    }
}
