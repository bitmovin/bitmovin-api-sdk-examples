using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Bitmovin.Api.Sdk.Common.Logging;
using Bitmovin.Api.Sdk.Examples.common;
using Bitmovin.Api.Sdk.Models;
using Stream = Bitmovin.Api.Sdk.Models.Stream;

namespace Bitmovin.Api.Sdk.Examples.AudioManipulations
{
    /// <summary>
    /// <para> This example demonstrates how to merge multiple stereo streams (from a single file, but this can
    /// easily be extended to select them from separate input files), adjusting gain on the second stream
    /// to turn it into a background effect</para>
    ///
    /// <para>This example illustrates one of the use cases in the [tutorial on audio manipulations]
    /// (https://bitmovin.com/docs/encoding/tutorials/separating-and-combining-audio-streams)</para>
    ///
    /// <br />
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
    /// <term>HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS</term>
    /// <description>The path to a file containing a video with 2 stereo tracks</description>
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
    /// </list>
    /// <br />
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
    public class StreamMergingBackgroundAudio : IExample
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

            var encoding = await CreateEncoding("Audio Mapping - Stream Merging",
                "Multiple stereo input tracks -> Output with single merged stereo track");

            var h264Config = await CreateH264VideoConfiguration();
            var aacConfig = await CreateAacAudioConfiguration();

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var inputFilePath = _configProvider.GetHttpInputFilePathWithTwoStereoTracks();
            var videoIngestInputStream = await CreateIngestInputStream(encoding, input, inputFilePath);

            var mainAudioIngestInputStream =
                await CreateIngestInputStreamForAudioTrack(encoding, input, inputFilePath, 0);
            var secondaryAudioIngestInputStream =
                await CreateIngestInputStreamForAudioTrack(encoding, input, inputFilePath, 1);

            var secondaryAudioMixInputStream = new AudioMixInputStream
            {
                ChannelLayout = AudioMixInputChannelLayout.CL_STEREO
            };

            for (var i = 0; i <= 1; i++)
            {
                var sourceChannel = new AudioMixInputStreamSourceChannel
                {
                    Type = AudioMixSourceChannelType.CHANNEL_NUMBER,
                    ChannelNumber = i,
                    Gain = 0.5
                };

                var inputStreamChannel = new AudioMixInputStreamChannel
                {
                    InputStreamId = secondaryAudioIngestInputStream.Id,
                    OutputChannelType = AudioMixChannelType.CHANNEL_NUMBER,
                    OutputChannelNumber = i,
                    SourceChannels = new List<AudioMixInputStreamSourceChannel>() {sourceChannel}
                };

                secondaryAudioMixInputStream.AudioMixChannels.Add(inputStreamChannel);
            }

            secondaryAudioMixInputStream = await _bitmovinApi.Encoding.Encodings.InputStreams.AudioMix.CreateAsync(
                encoding.Id, secondaryAudioMixInputStream);

            var videoStream =
                await CreateStream(encoding, new List<InputStream>() {videoIngestInputStream}, h264Config);
            var audioStream =
                await CreateStream(
                    encoding,
                    new List<InputStream>() {mainAudioIngestInputStream, secondaryAudioMixInputStream},
                    aacConfig);

            await CreateMp4Muxing(
                encoding,
                output,
                "/",
                new List<Stream>() {videoStream, audioStream},
                "stereo-and-surround-tracks-mapped.mp4");

            await ExecuteEncoding(encoding);
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
        /// <param name="inputStreams">The list of inputStream resources providing the input file, to be merged</param>
        /// <param name="configuration">The codec configuration to be applied to the stream</param>
        private Task<Stream> CreateStream(Models.Encoding encoding, List<InputStream> inputStreams,
            CodecConfiguration configuration)
        {
            var stream = new Stream()
            {
                CodecConfigId = configuration.Id,
                Mode = StreamMode.STANDARD
            };

            foreach (var inputStream in inputStreams)
            {
                stream.InputStreams.Add(new StreamInput {InputStreamId = inputStream.Id});
            }

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
        /// Creates an IngestInputStream and adds it to an encoding<para />
        ///
        /// The IngestInputStream is used to define where a file to read a stream from is located<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to which the stream will be added</param>
        /// <param name="input"> The input resource providing the input file</param>
        /// <param name="inputPath"> The path to the input file</param>
        private Task<IngestInputStream> CreateIngestInputStream(Models.Encoding encoding, Input input, String inputPath)
        {
            var ingestInputStream = new IngestInputStream()
            {
                InputId = input.Id,
                InputPath = inputPath,
                SelectionMode = StreamSelectionMode.AUTO
            };

            return _bitmovinApi.Encoding.Encodings.InputStreams.Ingest.CreateAsync(encoding.Id, ingestInputStream);
        }

        /// <summary>
        /// Creates an IngestInputStream to select a specific audio track in the input, and adds it to an encoding<para />
        ///
        /// The IngestInputStream is used to define where a file to read a stream from is located<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to which the stream will be added</param>
        /// <param name="input"> The input resource providing the input file</param>
        /// <param name="inputPath"> The path to the input file</param>
        /// <param name="position">The relative position of the audio track to select in the input file</param>
        private Task<IngestInputStream> CreateIngestInputStreamForAudioTrack(Models.Encoding encoding, Input input,
            String inputPath, int position)
        {
            var ingestInputStream = new IngestInputStream()
            {
                InputId = input.Id,
                InputPath = inputPath,
                SelectionMode = StreamSelectionMode.AUTO,
                Position = position
            };

            return _bitmovinApi.Encoding.Encodings.InputStreams.Ingest.CreateAsync(encoding.Id, ingestInputStream);
        }

        /// <summary>
        /// Creates a MP4 muxing.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="streams">A list of streams to be added to the muxing</param>
        /// <param name="fileName">The name of the file that will be written to the output</param>
        private Task CreateMp4Muxing(Models.Encoding encoding, Output output, string outputPath,
            List<Stream> streams, string fileName)
        {
            var muxing = new Mp4Muxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Filename = fileName
            };

            foreach (var stream in streams)
            {
                var muxingSteam = new MuxingStream() {StreamId = stream.Id};
                muxing.Streams.Add(muxingSteam);
            }

            return _bitmovinApi.Encoding.Encodings.Muxings.Mp4.CreateAsync(encoding.Id, muxing);
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
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(DefaultManifest), relativePath);
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