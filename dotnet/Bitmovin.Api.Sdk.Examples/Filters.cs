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
    /// This example demonstrates how to apply filters to a video stream.<para />
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
    /// <item>
    /// <term>WATERMARK_IMAGE_PATH</term>
    /// <description>The path to the watermark image.
    /// Example: http://my-storage.biz/logo.png</description>
    /// </item>
    /// <item>
    /// <term>TEXT_FILTER_TEXT</term>
    /// <description>The text to be displayed by the text filter</description>
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
    public class Filters : IExample
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

            var encoding = await CreateEncoding("Filter example",
                "Encoding with multiple filters applied to the video stream");

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

            var filters = new List<Filter>()
            {
                await CreateWatermarkFilter(),
                await CreateTextFilter(),
                await CreateDeinterlaceFilter()
            };

            await CreateStreamFilterList(encoding, h264VideoStream, filters);

            // Create an MP4 muxing with the H.264 and AAC streams
            await CreateMp4Muxing(encoding,
                output,
                "/",
                new List<Stream>() {h264VideoStream, aacAudioStream},
                "filter_applied.mp4");

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
        /// <para>Creates a list of the previously configured filter resources and adds them to a video stream.
        /// The <i>position</i> property of each StreamFilter determines the order in which they are applied.</para>
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStreamsFiltersByEncodingIdAndStreamId
        /// </summary>
        /// <param name="encoding">The encoding to which the video stream belongs to</param>
        /// <param name="stream">The video stream to apply the filters to</param>
        /// <param name="filters">A list of filter resources that have been created previously</param>
        private Task CreateStreamFilterList(Models.Encoding encoding, Stream stream, List<Filter> filters)
        {
            var streamFilters = new List<StreamFilter>();

            for (var position = 0; position < filters.Count; position++)
            {
                var streamFilter = new StreamFilter() {Id = filters.ElementAt(position).Id, Position = position};
                streamFilters.Add(streamFilter);
            }

            return _bitmovinApi.Encoding.Encodings.Streams.Filters.CreateAsync(encoding.Id, stream.Id, streamFilters);
        }

        /// <summary>
        /// Creates a watermark filter which displays the watermark image in the top left corner of the video<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersEnhancedWatermark
        /// </summary>
        private Task<WatermarkFilter> CreateWatermarkFilter()
        {
            var watermarkFilter = new WatermarkFilter()
            {
                Image = _configProvider.GetWatermarkImagePath(),
                Top = 10,
                Left = 10
            };

            return _bitmovinApi.Encoding.Filters.Watermark.CreateAsync(watermarkFilter);
        }

        /// <summary>
        /// Creates a text filter which displays the given text in the center of the video. X and Y positions
        /// are defined by the expressions "main_w / 2" and "main_h / 2", which mean half of the
        /// video's width and height.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersText
        /// </summary>
        private Task<TextFilter> CreateTextFilter()
        {
            var textFilter = new TextFilter()
            {
                Text = _configProvider.GetTextFilterText(),
                X = "main_w / 2",
                Y = "main_h / 2"
            };

            return _bitmovinApi.Encoding.Filters.Text.CreateAsync(textFilter);
        }

        /// <summary>
        /// Creates a deinterlace filter, which converts interlaced (https://en.wikipedia.org/wiki/Interlaced_video) to
        /// progressive (https://en.wikipedia.org/wiki/Progressive_scan) video. HLS requires deinterlaced video
        /// (https://bitmovin.com/rfc-compliant-hls-content-create/).<para />
        /// 
        /// The filter has no effect if the input is already progressive.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/filters#/Encoding/PostEncodingFiltersDeinterlace
        /// </summary>
        private Task<DeinterlaceFilter> CreateDeinterlaceFilter()
        {
            return _bitmovinApi.Encoding.Filters.Deinterlace.CreateAsync(new DeinterlaceFilter());
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
                var muxingSteam = new MuxingStream()
                {
                    StreamId = stream.Id,
                };

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
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(Filters), relativePath);
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
