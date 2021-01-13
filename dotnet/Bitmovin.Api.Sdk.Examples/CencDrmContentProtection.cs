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
    /// <para>This example shows how DRM content protection can be applied to a fragmented MP4 muxing. The
    /// encryption is configured to be compatible with both FairPlay and Widevine, using the MPEG-CENC standard.</para>
    ///
    /// <para />
    /// The following configuration parameters are expected:
    /// <list type="bullet">
    /// <item>
    /// <term>BITMOVIN_API_KEY</term>
    /// <description>Your API key for the Bitmovin API</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_HOST</term>
    /// <description>The Hostname or IP address of the HTTP server hosting your input files
    /// Example: my-storage.biz</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_FILE_PATH</term>
    /// <description>The path to your input file on the provided HTTP server
    /// Example: videos/1080p_Sintel.mp4</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_BUCKET_NAME</term>
    /// <description>The name of your S3 output bucket.
    /// Example: my-bucket-name</description>
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
    /// <item>
    /// <term>DRM_KEY</term>
    /// <description>16 byte encryption key, represented as 32 hexadecimal characters
    /// Example: cab5b529ae28d5cc5e3e7bc3fd4a544d</description>
    /// </item>
    /// <item>
    /// <term>DRM_FAIRPLAY_IV</term>
    /// <description>16 byte initialization vector, represented as 32 hexadecimal characters
    /// Example: 08eecef4b026deec395234d94218273d</description>
    /// </item>
    /// <item>
    /// <term>DRM_FAIRPLAY_URI</term>
    /// <description>URI of the licensing server
    /// Example: skd://userspecifc?custom=information</description>
    /// </item>
    /// <item>
    /// <term>DRM_WIDEVINE_PSSH</term>
    /// <description>Base64 encoded PSSH payload
    /// Example: QWRvYmVhc2Rmc2FkZmFzZg==</description>
    /// </item>
    /// <item>
    /// <term>DRM_WIDEVINE_KID</term>
    /// <description>16 byte encryption key id, represented as 32 hexadecimal characters
    /// Example: 08eecef4b026deec395234d94218273d</description>
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
    public class CencDrmContentProtection : IExample
    {
        private ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(args);
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                .WithLogger(new ConsoleLogger())
                .Build();

            var encoding =
                await CreateEncoding("fMP4 muxing with CENC DRM", "Example with CENC DRM content protection");

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var inputFilePath = _configProvider.GetHttpInputFilePath();

            // Add an H.264 video stream to the encoding
            var h264VideoConfig = await CreateH264VideoConfiguration();
            var h264VideoStream = await CreateStream(encoding, input, inputFilePath, h264VideoConfig);

            // Add an AAC audio stream to the encoding
            var aacConfig = await CreateAacAudioConfiguration();
            var aacAudioStream = await CreateStream(encoding, input, inputFilePath, aacConfig);

            var videoMuxing = await CreateFmp4Muxing(encoding, h264VideoStream);
            var audioMuxing = await CreateFmp4Muxing(encoding, aacAudioStream);

            await CreateDrmConfig(encoding, videoMuxing, output, "video");
            await CreateDrmConfig(encoding, audioMuxing, output, "audio");

            await ExecuteEncoding(encoding);

            await GenerateDashManifest(encoding, output, "/");
            await GenerateHlsManifest(encoding, output, "/");
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
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteEncoding(Models.Encoding encoding)
        {
            await _bitmovinApi.Encoding.Encodings.StartAsync(encoding.Id);

            ServiceTaskStatus serviceTaskStatus;
            do
            {
                await Task.Delay(5000);
                serviceTaskStatus = await _bitmovinApi.Encoding.Encodings.StatusAsync(encoding.Id);
                Console.WriteLine(
                    $"Encoding status is {serviceTaskStatus.Status} (progress: {serviceTaskStatus.Progress} %)");
            } while (serviceTaskStatus.Status != Status.FINISHED && serviceTaskStatus.Status != Status.ERROR);

            if (serviceTaskStatus.Status == Status.ERROR)
            {
                LogTaskErrors(serviceTaskStatus);
                throw new SystemException("Encoding failed");
            }

            Console.WriteLine("Encoding finished successfully");
        }

        /// <summary>
        /// Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and FairPlay
        /// specific fields will be included into DASH and HLS manifests to enable key retrieval using either
        /// DRM method.<para/>
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId
        /// </summary>
        /// <param name="encoding">The encoding to which the muxing belongs to</param>
        /// <param name="muxing">The muxing to apply the encryption to</param>
        /// <param name="output">The output resource to which the encrypted segments will be written to</param>
        /// <param name="outputPath">The output path where the encrypted segments will be written to</param>
        private Task CreateDrmConfig(Models.Encoding encoding, Muxing muxing, Output output,
            string outputPath)
        {
            var widevineDrm = new CencWidevine()
            {
                Pssh = _configProvider.GetDrmWidevinePssh()
            };

            var cencFairPlay = new CencFairPlay()
            {
                Iv = _configProvider.GetDrmFairplayIv(),
                Uri = _configProvider.GetDrmFairplayUri()
            };

            var cencDrm = new CencDrm()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Key = _configProvider.GetDrmKey(),
                Kid = _configProvider.GetDrmWidevineKid(),
                Widevine = widevineDrm,
                FairPlay = cencFairPlay
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Fmp4.Drm.Cenc.CreateAsync(encoding.Id, muxing.Id, cencDrm);
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
        private async Task GenerateDashManifest(Models.Encoding encoding, Output output, string outputPath)
        {
            var dashManifestDefault = new DashManifestDefault()
            {
                EncodingId = encoding.Id,
                ManifestName = "stream.mpd",
                Version = DashManifestDefaultVersion.V1,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)}
            };

            dashManifestDefault = await _bitmovinApi.Encoding.Manifests.Dash.Default.CreateAsync(dashManifestDefault);
            await ExecuteDashManifestCreation(dashManifestDefault);
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
        private async Task GenerateHlsManifest(Models.Encoding encoding, Output output, string outputPath)
        {
            var hlsManifestDefault = new HlsManifestDefault()
            {
                EncodingId = encoding.Id,
                Name = "master.m3u8",
                Version = HlsManifestDefaultVersion.V1,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)}
            };

            hlsManifestDefault = await _bitmovinApi.Encoding.Manifests.Hls.Default.CreateAsync(hlsManifestDefault);
            await ExecuteHlsManifestCreation(hlsManifestDefault);
        }

        /// <summary>
        /// <para>
        /// Starts the DASH manifest creation and periodically polls its status until it reaches a final state
        /// </para>
        /// <para>API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
        /// <br />
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId
        /// </para>
        /// </summary>
        /// <param name="dashManifest">The DASH manifest to be created</param>
        /// <exception cref="SystemException"></exception>
        private async Task ExecuteDashManifestCreation(DashManifest dashManifest)
        {
            await _bitmovinApi.Encoding.Manifests.Dash.StartAsync(dashManifest.Id);

            ServiceTaskStatus serviceTaskStatus;
            do
            {
                await Task.Delay(1000);
                serviceTaskStatus = await _bitmovinApi.Encoding.Manifests.Dash.StatusAsync(dashManifest.Id);
            } while (serviceTaskStatus.Status != Status.FINISHED && serviceTaskStatus.Status != Status.ERROR);

            if (serviceTaskStatus.Status == Status.ERROR)
            {
                LogTaskErrors(serviceTaskStatus);
                throw new SystemException("DASH manifest creation failed");
            }

            Console.WriteLine("DASH manifest creation finished successfully");
        }

        /// <summary>
        /// <para>
        /// Starts the HLS manifest creation and periodically polls its status until it reaches a final state
        /// </para>
        /// <para>API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
        /// <br />
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
        /// </para>
        /// </summary>
        /// <param name="hlsManifest">The HLS manifest to be created</param>
        /// <exception cref="SystemException"></exception>
        private async Task ExecuteHlsManifestCreation(HlsManifest hlsManifest)
        {
            await _bitmovinApi.Encoding.Manifests.Hls.StartAsync(hlsManifest.Id);

            ServiceTaskStatus task;
            do
            {
                await Task.Delay(1000);
                task = await _bitmovinApi.Encoding.Manifests.Hls.StatusAsync(hlsManifest.Id);
            } while (task.Status != Status.FINISHED && task.Status != Status.ERROR);

            if (task.Status == Status.ERROR)
            {
                LogTaskErrors(task);
                throw new SystemException("HLS manifest creation failed");
            }

            Console.WriteLine("HLS manifest creation finished successfully");
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
        /// for creating an S3 bucket and setting permissions for further information
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
        /// for the codec. See "How to optimize your H264 codec configuration for different use-cases"
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
                Name = "H.264 1080p 1.5 Mbit/s",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
                Height = 1080,
                Bitrate = 1500000
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
        /// Creates a fragmented MP4 muxing. This will split the output into continuously numbered segments
        /// of a given length for adaptive streaming. However, the unencrypted segments will not be written
        /// to a permanent storage as there's no output defined for the muxing. Instead, an output needs to
        /// be defined for the DRM configuration resource which will later be added to this muxing.<para/>
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to which the muxing will be added</param>
        /// <param name="stream">The stream to be muxed</param>
        private Task<Fmp4Muxing> CreateFmp4Muxing(Models.Encoding encoding, Stream stream)
        {
            var muxingStream = new MuxingStream()
            {
                StreamId = stream.Id
            };

            var muxing = new Fmp4Muxing()
            {
                SegmentLength = 4,
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
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(CencDrmContentProtection), relativePath);
        }

        /// <summary>
        /// Print all task errors
        /// </summary>
        /// <param name="task">Task with the errors</param>
        private void LogTaskErrors(ServiceTaskStatus task)
        {
            foreach (var message in task.Messages.Where(msg => msg.Type == MessageType.ERROR))
            {
                Console.WriteLine(message.Text);
            }
        }
    }
}