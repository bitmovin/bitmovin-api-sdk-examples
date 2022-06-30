using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Bitmovin.Api.Sdk.Common.Logging;
using Bitmovin.Api.Sdk.Examples.common;
using Bitmovin.Api.Sdk.Models;
using Stream = Bitmovin.Api.Sdk.Models.Stream;

namespace Bitmovin.Api.Sdk.Examples
{
    /// <summary>
    /// This example demonstrates how to create default DASH and HLS manifests for an encoding.<para />
    ///
    /// <para />
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
    /// <term>HTTP_INPUT_HOST</term>
    /// <description>The Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz</description>
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
    public class DefaultManifest : IExample
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

            var encoding = await CreateEncoding("Encoding with default manifests",
                "Encoding with HLS and DASH default manifests");

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var inputFilePath = _configProvider.GetHttpInputFilePath();

            // ABR Ladder - H264
            var h264VideoConfig_720_3000000 = await CreateH264VideoConfiguration(1280, 720, 3000000L);
            var h264VideoConfig_720_4608000 = await CreateH264VideoConfiguration(1280, 720, 4608000L);
            var h264VideoConfig_1080_6144000 = await CreateH264VideoConfiguration(1920, 1080, 6144000L);
            var h264VideoConfig_1080_7987200 = await CreateH264VideoConfiguration(1920, 1080, 7987200L);

            var videoConfigs = new List<H264VideoConfiguration>(){h264VideoConfig_720_3000000, h264VideoConfig_720_4608000, h264VideoConfig_1080_6144000, h264VideoConfig_1080_7987200};

            // create video streams and muxings
            foreach(H264VideoConfiguration config in videoConfigs)
            {
                var h264VideoStream = await CreateStream(encoding, input, inputFilePath, config);
                await CreateFmp4Muxing(encoding, output, String.Format("/video/{0}", config.Bitrate), h264VideoStream);
            }

            // Audio - ACC
            var aacConfig_192000 = await CreateAacAudioConfiguration(192000L);
            var aacConfig_64000 = await CreateAacAudioConfiguration(64000L);

            var audioConfigs = new List<AacAudioConfiguration>() {aacConfig_192000, aacConfig_64000};

            // create video streams and muxings
            foreach(AacAudioConfiguration config in audioConfigs)
            {
                var aacAudioStream = await CreateStream(encoding, input, inputFilePath, config);
                await CreateFmp4Muxing(encoding, output, String.Format("/audio/{0}", config.Bitrate), aacAudioStream);
            }

            var dashManifest = await CreateDefaultDashManifest(encoding, output, "/");
            var hlsManifest = await CreateDefaultHlsManifest(encoding, output, "/");

            var startEncodingRequest = new StartEncodingRequest()
            {
                ManifestGenerator = ManifestGenerator.V2,
                VodDashManifests = new List<ManifestResource>() { BuildManifestResource(dashManifest) },
                VodHlsManifests = new List<ManifestResource>() { BuildManifestResource(hlsManifest) }
            };

            await ExecuteEncoding(encoding, startEncodingRequest);
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
        /// <param name="encoding">The encoding to be started</param>
        /// <param name="startEncodingRequest">The request object to be sent with the start call</param>
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteEncoding(Models.Encoding encoding, StartEncodingRequest startEncodingRequest)
        {
            await _bitmovinApi.Encoding.Encodings.StartAsync(encoding.Id, startEncodingRequest);

            ServiceTaskStatus serviceTaskStatus;
            do
            {
                await Task.Delay(5000);
                serviceTaskStatus = await _bitmovinApi.Encoding.Encodings.StatusAsync(encoding.Id);
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
        /// Creates a resource representing an HTTP server providing the input files. For alternative input
        /// methods see list of supported input and output storages
        /// (https://bitmovin.com/docs/encoding/articles/supported-input-output-storages)<para />
        /// 
        /// For reasons of simplicity, a new input resource is created on each execution of this
        /// example. In production use, this method should be replaced by a get call to retrieve an existing resource.
        /// (https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId) 
        /// <para />
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp
        /// </summary>
        /// <param name="host">The hostname or IP address of the HTTP server e.g.: my-storage.biz</param> 
        private Task<HttpInput> CreateHttpInput(string host)
        {
            var input = new HttpInput()
            {
                Host = host
            };

            return _bitmovinApi.Encoding.Inputs.Http.CreateAsync(input);
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
        /// API endpoint:<para />
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
                InputStreams = new List<StreamInput>() { streamInput },
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
        /// for the codec. See "How to optimize your H264 codec configuration for different use-cases"
        /// (https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases)
        /// for alternative presets.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
        /// </summary>
        /// <param name="width">The width of the video file</param>
        /// <param name="height">The height of the video file</param>
        /// <param name="bitrate">The bitrate to be used</param>
        private Task<H264VideoConfiguration> CreateH264VideoConfiguration(int width, int height, long bitrate)
        {
            var config = new H264VideoConfiguration()
            {
                Name = $"H.264 {height}p {Math.Round((double) bitrate)/1000} Kbit/s",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
                Width = width,
                Height = height,
                Bitrate = bitrate
            };

            return _bitmovinApi.Encoding.Configurations.Video.H264.CreateAsync(config);
        }

        /// <summary>
        /// Creates a configuration for the AAC audio codec to be applied to audio streams.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
        /// </summary>
        /// <param name="bitrate">The bitrate to be used</param>
        private Task<AacAudioConfiguration> CreateAacAudioConfiguration(long bitrate)
        {
            var config = new AacAudioConfiguration()
            {
                Name = $"AAC {Math.Round((double) bitrate)/1000} Mbit/s",
                Bitrate = bitrate
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
                Outputs = new List<EncodingOutput>() { BuildEncodingOutput(output, outputPath) },
                Streams = new List<MuxingStream>() { muxingStream }
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
                Acl = new List<AclEntry>() { aclEntry }
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
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(DefaultManifest), relativePath);
        }


        /// <summary>
        /// Creates an DASH default manifest that automatically includes all representations configured in the encoding.
        /// <para />
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashDefault
        /// </summary>
        /// <param name="encoding">The encoding for which the manifest should be generated</param>
        /// <param name="output">The output to which the manifest should be written</param>
        /// <param name="outputPath">The path to which the manifest should be written</param>
        private async Task<DashManifest> CreateDefaultDashManifest(Models.Encoding encoding, Output output, string outputPath)
        {
            var dashManifestDefault = new DashManifestDefault()
            {
                EncodingId = encoding.Id,
                ManifestName = "stream.mpd",
                Version = DashManifestDefaultVersion.V1,
                Outputs = new List<EncodingOutput>() { BuildEncodingOutput(output, outputPath) }
            };

            return await _bitmovinApi.Encoding.Manifests.Dash.Default.CreateAsync(dashManifestDefault);
        }

        /// <summary>
        /// Creates an HLS default manifest that automatically includes all representations configured in the encoding.
        /// <para />
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
        /// </summary>
        /// <param name="encoding">The encoding for which the manifest should be generated</param>
        /// <param name="output">The output to which the manifest should be written</param>
        /// <param name="outputPath">The path to which the manifest should be written</param>
        private async Task<HlsManifest> CreateDefaultHlsManifest(Models.Encoding encoding, Output output, string outputPath)
        {
            var hlsManifestDefault = new HlsManifestDefault()
            {
                EncodingId = encoding.Id,
                Name = "master.m3u8",
                Version = HlsManifestDefaultVersion.V1,
                Outputs = new List<EncodingOutput>() { BuildEncodingOutput(output, outputPath) }
            };

            return await _bitmovinApi.Encoding.Manifests.Hls.Default.CreateAsync(hlsManifestDefault);
        }

        /// <summary>
        /// Wraps a manifest ID into a ManifestResource object, so it can be referenced in one of the
        /// StartEncodingRequest manifest lists.
        /// </summary>
        /// <param name="manifest">The manifest to be generated at the end of the encoding process</param>
        private ManifestResource BuildManifestResource(Manifest manifest)
        {
            return new ManifestResource()
            {
                ManifestId = manifest.Id
            };
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
