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
    /// This example demonstrates one mechanism to downmix a 5.1 audio stream down to stereo. It uses an advanced
    /// AudioMixInputStream configuration with gain adjusted on each input channel.<para />
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
    /// <term>HTTP_INPUT_HOST</term>
    /// <description>The Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_FILE_PATH_SURROUND_SOUND</term>
    /// <description>The path and filename for a file containing a video with a 5.1 audio stream</description>
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
    public class ChannelMixingDownmixing : IExample
    {
        private ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;
        private const string ClassName = "ChannelMixingDownmixing";
        private readonly string DATE_STRING = string.Concat(DateTime.UtcNow.ToString("s"), "Z");

        /// <summary>
        /// Helper classes representing the mapping from source channels to output channels.
        /// </summary>
        private class DownmixConfig
        {
            public AudioMixChannelType OutputChannelType { get; set; }
            public List<DownmixConfigChannel> SourceChannels { get; } = new List<DownmixConfigChannel>();

            public DownmixConfig(AudioMixChannelType outputChannelType)
            {
                  OutputChannelType = outputChannelType;
            }

            public void AddSourceChannel(AudioMixSourceChannelType sourceChannelType, Double gain)
            {
                SourceChannels.Add(new DownmixConfigChannel(sourceChannelType, gain));
            }
        }

        private class DownmixConfigChannel
        {
            public AudioMixSourceChannelType SourceChannelType {get; set;}
            public Double Gain {get; set;}

            public DownmixConfigChannel(AudioMixSourceChannelType sourceChannelType, Double gain)
            {
              SourceChannelType = sourceChannelType;
              Gain = gain;
            }
        }

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(args);
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                // uncomment the following line if you are working with a multi-tenant account
                // .WithTenantOrgIdKey(_configProvider.GetBitmovinTenantOrgId())
                .WithLogger(new ConsoleLogger())
                .Build();

            var encoding = await CreateEncoding("Audio Mapping - Channel Mixing - Downmixing", "Input with 5.1 track -> Output with downmixed stereo track");

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var inputFilePath = _configProvider.GetHttpInputFilePathWithSurroundSound();

            // Create an H264 video configuration.
            var h264VideoConfig = await CreateH264VideoConfiguration();

            // Create an AAC audio configuration.
            var aacAudioConfig = await CreateAacAudioConfiguration();

            // Add video and audio ingest input streams.
            var videoIngestInputStream = await CreateIngestInputStream(encoding, input, inputFilePath);
            var audioIngestInputStream = await CreateIngestInputStream(encoding, input, inputFilePath);

            // Create the Downmixing configurations.
            var channelConfigLeft = new DownmixConfig(AudioMixChannelType.FRONT_LEFT);

            channelConfigLeft.AddSourceChannel(AudioMixSourceChannelType.FRONT_LEFT, 1.0);
            channelConfigLeft.AddSourceChannel(AudioMixSourceChannelType.BACK_LEFT, 0.8);
            channelConfigLeft.AddSourceChannel(AudioMixSourceChannelType.CENTER, 0.5);

            var channelConfigRight = new DownmixConfig(AudioMixChannelType.FRONT_RIGHT);

            channelConfigRight.AddSourceChannel(AudioMixSourceChannelType.FRONT_RIGHT, 1.0);
            channelConfigRight.AddSourceChannel(AudioMixSourceChannelType.BACK_RIGHT, 0.8);
            channelConfigRight.AddSourceChannel(AudioMixSourceChannelType.CENTER, 0.5);

            var audioMixInputStream = await CreateDownmixInputStream(encoding, audioIngestInputStream, new List<DownmixConfig>(new []{channelConfigLeft, channelConfigRight}));

            // Create streams and add them to the encoding.
            var videoStream = await CreateStream(encoding, videoIngestInputStream, h264VideoConfig);
            var audioStream = await CreateStream(encoding, audioMixInputStream, aacAudioConfig);

            var streams =  new List<Stream>();
            streams.Add(videoStream);
            streams.Add(audioStream);

            await CreateMp4Muxing(encoding, output, "/", streams, "stereo-track-downmixed.mp4");
            await ExecuteEncoding(encoding);
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
        /// Starts the actual encoding process and periodically polls its status until it reaches a final state<para />
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
        /// <para />
        /// Please note that you can also use our webhooks API instead of polling the status. For more
        /// information consult the API spec:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
        /// </summary>
        /// <param name="encoding">The encoding to be started</param>
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteEncoding(Models.Encoding encoding)
        {
            await _bitmovinApi.Encoding.Encodings.StartAsync(encoding.Id);

            ServiceTaskStatus task;
            do
            {
                await Task.Delay(5000);
                task = await _bitmovinApi.Encoding.Encodings.StatusAsync(encoding.Id);
                Console.WriteLine($"Encoding status is {task.Status} (progress: {task.Progress} %)");
            } while (task.Status != Status.FINISHED && task.Status != Status.ERROR);

            if (task.Status == Status.ERROR)
            {
                LogTaskErrors(task);
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
        private Task<Stream> CreateStream(Models.Encoding encoding, InputStream inputStream,
            CodecConfiguration configuration)
        {
            var streamInput = new StreamInput()
            {
                InputStreamId = inputStream.Id
            };

            var stream = new Stream()
            {
                InputStreams = new List<StreamInput>() {streamInput},
                CodecConfigId = configuration.Id,
                Mode = StreamMode.STANDARD
            };

            return _bitmovinApi.Encoding.Encodings.Streams.CreateAsync(encoding.Id, stream);
        }

        /// <summary>
        /// Creates an IngestInputStream and adds it to an encoding
        /// The IngestInputStream is used to define where a file to read a stream from is located. <para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsIngestByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the stream onto</param>
        /// <param name="input">The input that should be used</param>
        /// <param name="inputPath">The path to the input file</param>
        private Task<IngestInputStream> CreateIngestInputStream(Models.Encoding encoding, Input input, string inputPath)
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
        /// Creates a MP4 muxing.
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsMp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the MP4 muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="stream">A list of streams to be added to the muxing</param>
        /// <param name="fileName"> The name of the file that will be written to the output
        private Task<Mp4Muxing> CreateMp4Muxing(Models.Encoding encoding, Output output, string outputPath,
            List<Stream> streams, String filename)
        {
            var muxingStreams = new List<MuxingStream>();
            foreach(Stream stream in streams)
            {
             var muxingSteam = new MuxingStream()
             {
                StreamId = stream.Id,
             };
            muxingStreams.Add(muxingSteam);
            }

            var muxing = new Mp4Muxing()
            {
                Filename = filename,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = muxingStreams,
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Mp4.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Adds an audio stream to an encoding, by remixing multiple channels from a source input stream
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsInputStreamsAudioMixByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to which the stream will be added</param>
        /// <param name="inputStream">The inputStream resource providing the input file</param>
        /// <param name="channelConfigs">The configuration of the source channel mixing and mapping to the output channels</param>
        private Task<AudioMixInputStream> CreateDownmixInputStream(Models.Encoding encoding, InputStream inputStream, List<DownmixConfig> channelConfigs)
        {
            var audioMixInputStream = new AudioMixInputStream()
            {
                Name = "Downmixing 5.1 to stereo",
                ChannelLayout = AudioMixInputChannelLayout.CL_STEREO
            };

            foreach(DownmixConfig channelConfig in channelConfigs)
            {
                var outputChannel = new AudioMixInputStreamChannel()
                {
                    InputStreamId = inputStream.Id,
                    OutputChannelType = channelConfig.OutputChannelType
                };

                foreach(DownmixConfigChannel channelSource in channelConfig.SourceChannels)
                {
                    var sourceChannel = new AudioMixInputStreamSourceChannel()
                    {
                        Type = channelSource.SourceChannelType,
                        Gain = channelSource.Gain
                    };
                    outputChannel.SourceChannels.Add(sourceChannel);
                }
                audioMixInputStream.AudioMixChannels.Add(outputChannel);
            }
            return _bitmovinApi.Encoding.Encodings.InputStreams.AudioMix.CreateAsync(encoding.Id, audioMixInputStream);
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
            return Path.Join(_configProvider.GetS3OutputBasePath(), $"{ClassName}-{DATE_STRING}", relativePath);
        }

        /// <summary>
        /// Print all task errors
        /// </summary>
        /// <param name="task">Task with the errors</param>
        private void LogTaskErrors(ServiceTaskStatus task)
        {
            foreach (var message in task.Messages.Where(message => message.Type == MessageType.ERROR))
            {
                Console.WriteLine(message.Text);
            }
        }
    }
}
