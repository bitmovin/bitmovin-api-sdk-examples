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
    /// This example demonstrates how to create multiple fMP4 renditions with Server-Side Ad Insertion (SSAI) <para />
    ///
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
    public class ServerSideAdInsertion : IExample
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

            var encoding = await CreateEncoding("Encoding with SSAI",
                "Encoding Example - SSAI conditioned HLS streams");

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var inputFilePath = _configProvider.GetHttpInputFilePath();

            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var videoConfigurations = new List<H264VideoConfiguration>()
            {
                await CreateH264VideoConfiguration(1080, 4_800_000),
                await CreateH264VideoConfiguration(720, 2_400_000),
                await CreateH264VideoConfiguration(480, 1_200_000),
                await CreateH264VideoConfiguration(360, 800_000),
                await CreateH264VideoConfiguration(240, 400_000)
            };

            // create a stream and fMP4 muxing for each video codec configuration
            var videoMuxings = new Dictionary<VideoConfiguration, Fmp4Muxing>();
            foreach (var videoConfig in videoConfigurations)
            {
                var videoStream = await CreateStream(encoding, input, inputFilePath, videoConfig);
                var muxing = await CreateFmp4Muxing(encoding, output, $"video/{videoConfig.Height}", videoStream);
                videoMuxings[videoConfig] = muxing;
            }

            // create a stream and fMP4 muxing for audio
            var aacConfig = await CreateAacAudioConfiguration();
            var aacAudioStream = await CreateStream(encoding, input, inputFilePath, aacConfig);
            var aacAudioMuxing = await CreateFmp4Muxing(encoding, output, "audio", aacAudioStream);

            // seconds in which to add a custom HLS tag for ad placement, as well as when to insert a
            // keyframe/split a segment
            var adBreakPlacements = new List<double>() {5.0, 15.0};

            // define keyframes that are used to insert advertisement tags into the manifest
            var keyframes = await CreateKeyframes(encoding, adBreakPlacements);

            await ExecuteEncoding(encoding);

            // create the master manifest that references audio and video playlists
            var manifestHls = await CreateHlsMasterManifest(output, "/");

            // create an audio playlist and provide it with custom tags for ad-placement
            var audioMediaInfo = await CreateAudioMediaPlaylist(encoding, manifestHls, aacAudioMuxing, "audio/");
            await PlaceAudioAdvertisementTags(manifestHls, audioMediaInfo, keyframes);

            // create a video playlist for each video muxing and provide it with custom tags for ad-placement
            foreach (var key in videoMuxings.Keys)
            {
                var streamInfo = await CreateVideoStreamPlaylist(
                    encoding,
                    manifestHls,
                    $"video_${key.Height}.m3u8",
                    videoMuxings[key],
                    $"video/${key.Height}",
                    audioMediaInfo
                );
                await PlaceVideoAdvertisementTags(manifestHls, streamInfo, keyframes);
            }

            await ExecuteHlsManifestCreation(manifestHls);
        }

        /// <summary>
        /// Starts the actual encoding process and periodically polls its status until it reaches a final state<para />
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
        /// <br />
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
        /// Starts the HLS manifest creation and periodically polls its status until it reaches a final state<para />
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
        /// <br />
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
        /// </summary>
        /// <param name="hlsManifest">The HLS manifest to be created</param>
        private async Task ExecuteHlsManifestCreation(HlsManifest hlsManifest)
        {
            await _bitmovinApi.Encoding.Manifests.Hls.StartAsync(hlsManifest.Id);

            ServiceTaskStatus serviceTaskStatus;
            do
            {
                await Task.Delay(1000);
                serviceTaskStatus = await _bitmovinApi.Encoding.Manifests.Hls.StatusAsync(hlsManifest.Id);
            } while (serviceTaskStatus.Status != Status.FINISHED && serviceTaskStatus.Status != Status.ERROR);

            if (serviceTaskStatus.Status == Status.ERROR)
            {
                LogTaskErrors(serviceTaskStatus);
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
        private Task<H264VideoConfiguration> CreateH264VideoConfiguration(int height, int bitrate)
        {
            var config = new H264VideoConfiguration()
            {
                Name = $"H.264 {height}p",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
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
        /// Creates keyframes at specified positions of the encoded output. With SegmentCut set to true,
        /// the written segments will be split at keyframe positions.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsKeyframesByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to which keyframes should be added</param>
        /// <param name="breakPlacements">he points in time where keyframes should be inserted
        /// (specified in seconds)</param>
        private async Task<List<Keyframe>> CreateKeyframes(Models.Encoding encoding,
            List<double> breakPlacements)
        {
            var keyframes = new List<Keyframe>();

            foreach (var adBreak in breakPlacements)
            {
                var keyframe = new Keyframe()
                {
                    Time = adBreak,
                    SegmentCut = true
                };

                keyframes.Add(await _bitmovinApi.Encoding.Encodings.Keyframes.CreateAsync(encoding.Id, keyframe));
            }

            return keyframes;
        }

        /// <summary>
        /// Creates an HLS master manifest<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
        /// </summary>
        /// <param name="output">The output resource to which the manifest will be written to</param>
        /// <param name="outputPath">The path where the manifest will be written to</param>
        private Task<HlsManifest> CreateHlsMasterManifest(Output output, string outputPath)
        {
            var hlsManifest = new HlsManifest()
            {
                Name = "master.m3u8",
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)}
            };

            return _bitmovinApi.Encoding.Manifests.Hls.CreateAsync(hlsManifest);
        }

        /// <summary>
        /// Creates an HLS audio media playlist<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaAudioByManifestId
        /// </summary>
        /// <param name="encoding">The encoding to which the manifest belongs to</param>
        /// <param name="hlsManifest">The manifest to which the playlist should be added</param>
        /// <param name="audioMuxing">The audio muxing for which the playlist should be generated</param>
        /// <param name="segmentPath">The path containing the audio segments to be referenced by the playlist</param>
        private Task<AudioMediaInfo> CreateAudioMediaPlaylist(Models.Encoding encoding, HlsManifest hlsManifest,
            Fmp4Muxing audioMuxing, string segmentPath)
        {
            var audioMediaInfo = new AudioMediaInfo()
            {
                Name = "audio.m3u8",
                Uri = "audio.m3u8",
                GroupId = "audio",
                EncodingId = encoding.Id,
                StreamId = audioMuxing.Streams[0].StreamId,
                MuxingId = audioMuxing.Id,
                Language = "en",
                AssocLanguage = "en",
                Autoselect = false,
                IsDefault = false,
                Forced = false,
                SegmentPath = segmentPath
            };

            return _bitmovinApi.Encoding.Manifests.Hls.Media.Audio.CreateAsync(hlsManifest.Id, audioMediaInfo);
        }

        /// <summary>
        /// Adds custom tags for ad-placement to an HLS audio media playlist at given keyframe positions<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaCustomTagByManifestIdAndMediaId
        /// </summary>
        /// <param name="manifest">The master manifest to which the playlist belongs to</param>
        /// <param name="audioMediaInfo">The audio media playlist to which the tags should be added</param>
        /// <param name="keyframes">A list of keyframes specifying the positions where tags will be inserted</param>
        private async Task PlaceAudioAdvertisementTags(HlsManifest manifest,
            AudioMediaInfo audioMediaInfo, List<Keyframe> keyframes)
        {
            foreach (var keyframe in keyframes)
            {
                var customTag = new CustomTag()
                {
                    KeyframeId = keyframe.Id,
                    PositionMode = PositionMode.KEYFRAME,
                    Data = "#AD-PLACEMENT-OPPORTUNITY"
                };

                await _bitmovinApi.Encoding.Manifests.Hls.Media.CustomTags.CreateAsync(manifest.Id,
                    audioMediaInfo.Id, customTag);
            }
        }

        /// <summary>
        /// Adds custom tags for ad-placement to an HLS video stream playlist at given keyframe positions<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStreamsCustomTagByManifestIdAndStreamId
        /// </summary>
        /// <param name="hlsManifest">The master manifest to which the playlist belongs to</param>
        /// <param name="streamInfo">The video stream playlist to which the tags should be added</param>
        /// <param name="keyframes">A list of keyframes specifying the positions where tags will be inserted</param>
        private async Task PlaceVideoAdvertisementTags(HlsManifest hlsManifest, StreamInfo streamInfo,
            List<Keyframe> keyframes)
        {
            foreach (var keyframe in keyframes)
            {
                var customTag = new CustomTag()
                {
                    KeyframeId = keyframe.Id,
                    PositionMode = PositionMode.KEYFRAME,
                    Data = "#AD-PLACEMENT-OPPORTUNITY"
                };

                await _bitmovinApi.Encoding.Manifests.Hls.Streams.CustomTags.CreateAsync(hlsManifest.Id, streamInfo.Id,
                    customTag);
            }
        }

        /// <summary>
        /// Creates an HLS video playlist<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStreamsByManifestId
        /// </summary>
        /// <param name="encoding">The encoding to which the manifest belongs to</param>
        /// <param name="hlsManifest">The manifest to which the playlist should be added</param>
        /// <param name="filename">The filename to be used for the playlist file</param>
        /// <param name="videoMuxing">The video muxing for which the playlist should be generated</param>
        /// <param name="segmentPath">The path containing the video segments to be referenced</param>
        /// <param name="audioMediaInfo">The audio media playlist containing the associated audio group id</param>
        private Task<StreamInfo> CreateVideoStreamPlaylist(Models.Encoding encoding, HlsManifest hlsManifest,
            string filename, Fmp4Muxing videoMuxing, string segmentPath, AudioMediaInfo audioMediaInfo)
        {
            var streamInfo = new StreamInfo()
            {
                Uri = filename,
                EncodingId = encoding.Id,
                StreamId = videoMuxing.Streams.ElementAt(0).StreamId,
                MuxingId = videoMuxing.Id,
                Audio = audioMediaInfo.GroupId,
                SegmentPath = segmentPath
            };

            return _bitmovinApi.Encoding.Manifests.Hls.Streams.CreateAsync(hlsManifest.Id, streamInfo);
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
                Permission = AclPermission.PUBLICREAD
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
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(ServerSideAdInsertion), relativePath);
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
