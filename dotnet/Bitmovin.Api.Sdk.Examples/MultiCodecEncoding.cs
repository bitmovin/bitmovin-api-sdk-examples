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
    /// This example showcases how to run a multi-codec workflow with the Bitmovin API following the best
    /// practices. It is currently recommended to run one encoding job per codec to achieve optimal
    /// performance and execution stability. After the encodings have been performed, renditions from
    /// multiple encodings can be muxed together to build the desired manifest.<para />
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
    public class MultiCodecEncoding : IExample
    {
        private ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;
        private const string ClassName = "MultiCodecEncoding";
        private const string HLS_AUDIO_GROUP_AAC_FMP4 = "audio-aac-fmp4";
        private const string HLS_AUDIO_GROUP_AAC_TS = "audio-aac-ts";
        private const string HLS_AUDIO_GROUP_AC3_FMP4 = "audio-ac3-fmp4";
        private readonly string DATE_STRING = string.Concat(DateTime.UtcNow.ToString("s"), "Z");

        private class Rendition
        {
            public int Height { get; }
            public long Bitrate { get; }

            public Rendition(int height, long bitrate)
            {
                Height = height;
                Bitrate = bitrate;
            }
        }

        private class H264AndAacEncodingTracking
        {
            public Models.Encoding Encoding { get; }

            public List<Rendition> Renditions { get; } = new List<Rendition>()
            {
                new Rendition(234, 145_000L),
                new Rendition(360, 365_000L),
                new Rendition(432, 730_000L),
                new Rendition(540, 2_000_000L),
                new Rendition(720, 3_000_000L)
            };

            public Dictionary<Rendition, Stream> H264VideoStreams { get; } = new Dictionary<Rendition, Stream>();
            public Dictionary<Rendition, CmafMuxing> H264CmafMuxings { get; } = new Dictionary<Rendition, CmafMuxing>();
            public Dictionary<Rendition, TsMuxing> H264TsMuxings { get; } = new Dictionary<Rendition, TsMuxing>();

            public Stream AacAudioStream { get; set; }
            public Fmp4Muxing AacFmp4Muxing { get; set; }
            public TsMuxing AacTsMuxing { get; set; }

            public const string H264_TS_SEGMENTS_PATH = "video/h264/ts/";
            public const string H264_CMAF_SEGMENTS_PATH = "video/h264/cmaf/";
            public const string AAC_FMP4_SEGMENTS_PATH = "audio/aac/fmp4";
            public const string AAC_TS_SEGMENTS_PATH = "audio/aac/ts";

            public H264AndAacEncodingTracking(Models.Encoding encoding)
            {
                Encoding = encoding;
            }
        }

        private class H265AndAc3EncodingTracking
        {
            public Models.Encoding Encoding { get; }

            public List<Rendition> Renditions { get; } = new List<Rendition>()
            {
                new Rendition(540, 600_000L),
                new Rendition(720, 2_400_000L),
                new Rendition(1080, 4_500_000L),
                new Rendition(2160, 11_600_000L)
            };

            public Dictionary<Rendition, Stream> H265VideoStreams { get; } = new Dictionary<Rendition, Stream>();
            public Dictionary<Rendition, Fmp4Muxing> H265Fmp4Muxings { get; } = new Dictionary<Rendition, Fmp4Muxing>();

            public Stream Ac3AudioStream { get; set; }
            public Fmp4Muxing Ac3Fmp4Muxing { get; set; }

            public const string H265_FMP4_SEGMENTS_PATH = "video/h265/fmp4/";
            public const string AC3_FMP4_SEGMENTS_PATH = "audio/ac3/fmp4";

            public H265AndAc3EncodingTracking(Models.Encoding encoding)
            {
                Encoding = encoding;
            }
        }

        private class Vp9AndVorbisEncodingTracking
        {
            public Models.Encoding Encoding { get; }

            public List<Rendition> Renditions { get; } = new List<Rendition>()
            {
                new Rendition(540, 600_000L),
                new Rendition(720, 2_400_000L),
                new Rendition(1080, 4_500_000L),
                new Rendition(2160, 11_600_000L)
            };

            public Dictionary<Rendition, WebmMuxing> Vp9WebmMuxing { get; } = new Dictionary<Rendition, WebmMuxing>();
            public WebmMuxing VorbisWebmMuxing { get; set; }

            public const string VP9_WEBM_SEGMENTS_PATH = "video/webm/vp9/";
            public const string VORBIS_WEBM_SEGMENTS_PATH = "audio/vorbis/webm";

            public Vp9AndVorbisEncodingTracking(Models.Encoding encoding)
            {
                Encoding = encoding;
            }
        }

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(args);
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                .WithLogger(new ConsoleLogger())
                .Build();

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var inputFilePath = _configProvider.GetHttpInputFilePath();

            var h264AndAacEncodingTracking = await CreateH264AndAacEncoding(input, inputFilePath, output);
            var h265AndAc3EncodingTracking = await CreateH265AndAc3Encoding(input, inputFilePath, output);
            var vp9AndVorbisEncodingTracking = await CreateVp9AndVorbisEncoding(input, inputFilePath, output);

            Task.WaitAll(ExecuteEncoding(h264AndAacEncodingTracking.Encoding),
                ExecuteEncoding(h265AndAc3EncodingTracking.Encoding),
                ExecuteEncoding(vp9AndVorbisEncodingTracking.Encoding));

            var dashManifest = await CreateDashManifest(output,
                h264AndAacEncodingTracking,
                h265AndAc3EncodingTracking,
                vp9AndVorbisEncodingTracking);
            await ExecuteDashManifest(dashManifest);

            var hlsManifest = await CreateHlsManifest(output, h264AndAacEncodingTracking, h265AndAc3EncodingTracking);
            await ExecuteHlsManifest(hlsManifest);
        }

        /// <summary>
        /// Creates the encoding with H264 codec/TS muxing, H264 codec/CMAF muxing, AAC codec/fMP4 muxing
        /// </summary>
        /// <param name="input">the input that should be used</param>
        /// <param name="inputFilePath">the path to the input file</param>
        /// <param name="output">the output that should be used</param>
        /// <returns>the tracking information for the encoding</returns>
        private async Task<H264AndAacEncodingTracking> CreateH264AndAacEncoding(HttpInput input, string inputFilePath,
            Output output)
        {
            var encoding = await CreateEncoding("H.264 Encoding",
                "H.264 -> TS muxing, H.264 -> CMAF muxing, AAC -> fMP4 muxing, AAC -> TS muxing");

            var encodingTracking = new H264AndAacEncodingTracking(encoding);

            foreach (var rendition in encodingTracking.Renditions)
            {
                var videoConfiguration = await CreateH264VideoConfiguration(rendition.Height, rendition.Bitrate);
                var videoStream = await CreateStream(encoding, input, inputFilePath, videoConfiguration);

                var cmafMuxingOutputPath = $"{H264AndAacEncodingTracking.H264_CMAF_SEGMENTS_PATH}" +
                                           $"{rendition.Height}p_{rendition.Bitrate}";
                var tsMuxingOutputPath = $"{H264AndAacEncodingTracking.H264_TS_SEGMENTS_PATH}" +
                                         $"{rendition.Height}p_{rendition.Bitrate}";

                var cmafMuxing = await CreateCmafMuxing(encoding, output, cmafMuxingOutputPath, videoStream);
                var tsMuxing = await CreateTsMuxing(encoding, output, tsMuxingOutputPath, videoStream);

                encodingTracking.H264VideoStreams.Add(rendition, videoStream);
                encodingTracking.H264CmafMuxings.Add(rendition, cmafMuxing);
                encodingTracking.H264TsMuxings.Add(rendition, tsMuxing);
            }

            // Add an AAC audio stream to the encoding
            var aacConfig = await CreateAacAudioConfiguration();
            var aacAudioStream = await CreateStream(encoding, input, inputFilePath, aacConfig);
            encodingTracking.AacAudioStream = aacAudioStream;

            // Create a fMP4 muxing and a TS muxing with the AAC stream
            encodingTracking.AacFmp4Muxing = await CreateFmp4Muxing(encoding, output,
                H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH, aacAudioStream);

            encodingTracking.AacTsMuxing =
                await CreateTsMuxing(encoding, output, H264AndAacEncodingTracking.AAC_TS_SEGMENTS_PATH, aacAudioStream);

            return encodingTracking;
        }

        /// <summary>
        /// Creates the encoding with H265 codec/fMP4 muxing, AC3 codec/fMP4 muxing
        /// </summary>
        /// <param name="input">the input that should be used</param>
        /// <param name="inputFilePath">the path to the input file</param>
        /// <param name="output">the output that should be used</param>
        /// <returns>the tracking information for the encoding</returns>
        private async Task<H265AndAc3EncodingTracking> CreateH265AndAc3Encoding(HttpInput input, string inputFilePath,
            Output output)
        {
            var encoding = await CreateEncoding("H.265 Encoding", "H.265 -> fMP4 muxing, AC3 -> fMP4 muxing");

            var encodingTracking = new H265AndAc3EncodingTracking(encoding);

            foreach (var rendition in encodingTracking.Renditions)
            {
                var videoConfiguration = await CreateH265VideoConfiguration(rendition.Height, rendition.Bitrate);
                var videoStream = await CreateStream(encoding, input, inputFilePath, videoConfiguration);

                var fmp4MuxingOutputPath = $"{H265AndAc3EncodingTracking.H265_FMP4_SEGMENTS_PATH}" +
                                           $"{rendition.Height}p_{rendition.Bitrate}";

                var fmp4Muxing = await CreateFmp4Muxing(encoding, output, fmp4MuxingOutputPath, videoStream);

                encodingTracking.H265VideoStreams.Add(rendition, videoStream);
                encodingTracking.H265Fmp4Muxings.Add(rendition, fmp4Muxing);
            }

            // Add an AC3 audio stream to the encoding
            var ac3AudioConfiguration = await CreateAc3AudioConfiguration();
            var ac3AudioStream = await CreateStream(encoding, input, inputFilePath, ac3AudioConfiguration);
            encodingTracking.Ac3AudioStream = ac3AudioStream;

            // Create a fMP4 muxing muxing with the AC3 stream
            encodingTracking.Ac3Fmp4Muxing = await CreateFmp4Muxing(encoding, output,
                H265AndAc3EncodingTracking.AC3_FMP4_SEGMENTS_PATH, ac3AudioStream);

            return encodingTracking;
        }

        /// <summary>
        /// Created the encoding with VP9 codec/WebM muxing, Vorbis codec / WebM muxing
        /// </summary>
        /// <param name="input">the input that should be used</param>
        /// <param name="inputFilePath">the path to the input file</param>
        /// <param name="output">the output that should be used</param>
        /// <returns>the tracking information for the encoding</returns>
        private async Task<Vp9AndVorbisEncodingTracking> CreateVp9AndVorbisEncoding(
            HttpInput input, string inputFilePath, Output output)
        {
            var encoding = await CreateEncoding("VP9/Vorbis Encoding", "VP9 -> WebM muxing, Vorbis -> WebM muxing");

            var encodingTracking = new Vp9AndVorbisEncodingTracking(encoding);

            // Create video streams and add webm muxings to the VP9 encoding
            foreach (var rendition in encodingTracking.Renditions)
            {
                var vp9Config =
                    await CreateVp9VideoConfiguration(rendition.Height, rendition.Bitrate);
                var vp9VideoStream = await CreateStream(encoding, input, inputFilePath, vp9Config);

                encodingTracking.Vp9WebmMuxing.Add(
                    rendition,
                    await CreateWebmMuxing(
                        encoding,
                        output,
                        $"{Vp9AndVorbisEncodingTracking.VP9_WEBM_SEGMENTS_PATH}" +
                        $"{rendition.Height}p_{rendition.Bitrate}",
                        vp9VideoStream));
            }

            // Create Vorbis audio configuration
            var vorbisAudioConfiguration = await CreateVorbisAudioConfiguration();
            var vorbisAudioStream = await CreateStream(encoding, input, inputFilePath, vorbisAudioConfiguration);

            // Create a WebM muxing with the Vorbis audio stream
            encodingTracking.VorbisWebmMuxing = await CreateWebmMuxing(
                encoding,
                output,
                Vp9AndVorbisEncodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
                vorbisAudioStream);

            return encodingTracking;
        }

        /// <summary>
        /// Creates the DASH manifest with all the representations.
        /// </summary>
        /// <param name="output">the output that should be used</param>
        /// <param name="h264AndAacEncodingTracking">the tracking information for the H264/AAC encoding</param>
        /// <param name="h265AndAc3EncodingTracking">the tracking information for the H265 encoding</param>
        /// <param name="vp9AndVorbisEncodingTracking">the tracking information for the VP9/Vorbis encoding</param>
        /// <returns>the created DASH manifest</returns>
        private async Task<DashManifest> CreateDashManifest(Output output,
            H264AndAacEncodingTracking h264AndAacEncodingTracking,
            H265AndAc3EncodingTracking h265AndAc3EncodingTracking,
            Vp9AndVorbisEncodingTracking vp9AndVorbisEncodingTracking)
        {
            var dashManifest = await CreateDashManifest("stream.mpd", DashProfile.LIVE, output, "/");

            var period = await
                _bitmovinApi.Encoding.Manifests.Dash.Periods.CreateAsync(dashManifest.Id, new Period());

            var videoAdaptationSetVp9 = await
                _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Video.CreateAsync(
                    dashManifest.Id, period.Id, new VideoAdaptationSet());

            var videoAdaptationSetH265 = await
                _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Video.CreateAsync(
                    dashManifest.Id, period.Id, new VideoAdaptationSet());

            var videoAdaptationSetH264 = await
                _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Video.CreateAsync(
                    dashManifest.Id, period.Id, new VideoAdaptationSet());

            var vorbisAudioAdaptationSet = await CreateAudioAdaptionSet(dashManifest, period, "en");
            var ac3AudioAdaptationSet = await CreateAudioAdaptionSet(dashManifest, period, "en");
            var aacAudioAdaptationSet = await CreateAudioAdaptionSet(dashManifest, period, "en");

            // Add representations to VP9 adaptation set
            // Add VP9 WEBM muxing to VP9 adaptation set
            foreach (var rendition in vp9AndVorbisEncodingTracking.Vp9WebmMuxing.Keys)
            {
                await CreateDashWebmRepresentation(
                    vp9AndVorbisEncodingTracking.Encoding,
                    vp9AndVorbisEncodingTracking.Vp9WebmMuxing[rendition],
                    dashManifest,
                    period,
                    $"{Vp9AndVorbisEncodingTracking.VP9_WEBM_SEGMENTS_PATH}" +
                    $"{rendition.Height}p_{rendition.Bitrate}",
                    videoAdaptationSetVp9.Id);
            }

            // Add VORBIS WEBM muxing to VORBIS audio adaptation set
            await CreateDashWebmRepresentation(
                vp9AndVorbisEncodingTracking.Encoding,
                vp9AndVorbisEncodingTracking.VorbisWebmMuxing,
                dashManifest,
                period,
                Vp9AndVorbisEncodingTracking.VORBIS_WEBM_SEGMENTS_PATH,
                vorbisAudioAdaptationSet.Id);

            // Add representations to H265 adaptation set
            // Add H265 FMP4 muxing to H265 video adaptation set
            foreach (var rendition in h265AndAc3EncodingTracking.H265Fmp4Muxings.Keys)
            {
                await CreateDashFmp4Representation(
                    h265AndAc3EncodingTracking.Encoding,
                    h265AndAc3EncodingTracking.H265Fmp4Muxings[rendition],
                    dashManifest,
                    period,
                    $"{H265AndAc3EncodingTracking.H265_FMP4_SEGMENTS_PATH}" +
                    $"{rendition.Height}p_{rendition.Bitrate}",
                    videoAdaptationSetH265.Id);
            }

            // Add AC3 FMP4 muxing to AAC audio adaptation set
            await CreateDashFmp4Representation(
                h265AndAc3EncodingTracking.Encoding,
                h265AndAc3EncodingTracking.Ac3Fmp4Muxing,
                dashManifest,
                period,
                H265AndAc3EncodingTracking.AC3_FMP4_SEGMENTS_PATH,
                ac3AudioAdaptationSet.Id);

            // Add representations to H264 adaptation set
            // Add H264 CMAF muxing to H264 video adaptation set
            foreach (var rendition in h264AndAacEncodingTracking.H264CmafMuxings.Keys)
            {
                await CreateDashCmafRepresentation(
                    h264AndAacEncodingTracking.Encoding,
                    h264AndAacEncodingTracking.H264CmafMuxings[rendition],
                    dashManifest,
                    period,
                    $"{H264AndAacEncodingTracking.H264_CMAF_SEGMENTS_PATH}" +
                    $"{rendition.Height}p_{rendition.Bitrate}",
                    videoAdaptationSetH264.Id);
            }

            // Add AAC FMP4 muxing to AAC audio adaptation set
            await CreateDashFmp4Representation(
                h264AndAacEncodingTracking.Encoding,
                h264AndAacEncodingTracking.AacFmp4Muxing,
                dashManifest,
                period,
                H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
                aacAudioAdaptationSet.Id);

            return dashManifest;
        }

        /// <summary>
        /// Creates the HLS manifest master playlist with the different sub playlists
        /// </summary>
        /// <param name="output">the output that should be used</param>
        /// <param name="h264AndAacEncodingTracking">the tracking information for the H264/AAC encoding</param>
        /// <param name="h265AndAc3EncodingTracking">the tracking information for the H265 encoding</param>
        /// <returns>the created HLS manifest</returns>
        private async Task<HlsManifest> CreateHlsManifest(
            Output output,
            H264AndAacEncodingTracking h264AndAacEncodingTracking,
            H265AndAc3EncodingTracking h265AndAc3EncodingTracking)
        {
            var hlsManifest = await CreateHlsMasterManifest("master.m3u8", output, "/");

            // Create h265 audio playlists
            await CreateAudioMediaPlaylist(
                h265AndAc3EncodingTracking.Encoding,
                hlsManifest,
                h265AndAc3EncodingTracking.Ac3Fmp4Muxing,
                h265AndAc3EncodingTracking.Ac3AudioStream,
                "audio_ac3_fmp4.m3u8",
                H265AndAc3EncodingTracking.AC3_FMP4_SEGMENTS_PATH,
                HLS_AUDIO_GROUP_AC3_FMP4);

            // Create h265 video playlists
            foreach (var rendition in h265AndAc3EncodingTracking.H265Fmp4Muxings.Keys)
            {
                await CreateVideoStreamPlaylist(
                    h265AndAc3EncodingTracking.Encoding,
                    hlsManifest,
                    h265AndAc3EncodingTracking.H265Fmp4Muxings[rendition],
                    h265AndAc3EncodingTracking.H265VideoStreams[rendition],
                    $"video_h265_{rendition.Height}p_{rendition.Bitrate}.m3u8",
                    $"{H265AndAc3EncodingTracking.H265_FMP4_SEGMENTS_PATH}" +
                    $"{rendition.Height}p_{rendition.Bitrate}",
                    HLS_AUDIO_GROUP_AC3_FMP4);
            }

            // Create h264 audio playlists
            await CreateAudioMediaPlaylist(
                h264AndAacEncodingTracking.Encoding,
                hlsManifest,
                h264AndAacEncodingTracking.AacFmp4Muxing,
                h264AndAacEncodingTracking.AacAudioStream,
                "audio_aac_fmp4.m3u8",
                H264AndAacEncodingTracking.AAC_FMP4_SEGMENTS_PATH,
                HLS_AUDIO_GROUP_AAC_FMP4);

            await CreateAudioMediaPlaylist(
                h264AndAacEncodingTracking.Encoding,
                hlsManifest,
                h264AndAacEncodingTracking.AacTsMuxing,
                h264AndAacEncodingTracking.AacAudioStream,
                "audio_aac_ts.m3u8",
                H264AndAacEncodingTracking.AAC_TS_SEGMENTS_PATH,
                HLS_AUDIO_GROUP_AAC_TS);

            // Create h264 video playlists
            foreach (var rendition in h264AndAacEncodingTracking.H264TsMuxings.Keys)
            {
                await CreateVideoStreamPlaylist(
                    h264AndAacEncodingTracking.Encoding,
                    hlsManifest,
                    h264AndAacEncodingTracking.H264TsMuxings[rendition],
                    h264AndAacEncodingTracking.H264VideoStreams[rendition],
                    $"video_h264_{rendition.Height}p_{rendition.Bitrate}.m3u8",
                    $"{H264AndAacEncodingTracking.H264_TS_SEGMENTS_PATH}" +
                    $"{rendition.Height}p_{rendition.Bitrate}",
                    HLS_AUDIO_GROUP_AAC_TS);
            }

            return hlsManifest;
        }

        // Creates an audio adaption set for the dash manifest
        private Task<AudioAdaptationSet> CreateAudioAdaptionSet(DashManifest dashManifest, Period period,
            String language)
        {
            var audioAdaptationSet = new AudioAdaptationSet()
            {
                Lang = language
            };

            return _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Audio.CreateAsync(
                dashManifest.Id, period.Id, audioAdaptationSet);
        }

        /// <summary>
        /// Creates the HLS master manifest.
        /// </summary>
        private Task<HlsManifest> CreateHlsMasterManifest(string name, Output output, string outputPath)
        {
            var hlsManifest = new HlsManifest()
            {
                Name = name,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)}
            };

            return _bitmovinApi.Encoding.Manifests.Hls.CreateAsync(hlsManifest);
        }

        /// <summary>
        /// Creates an HLS audio media playlist.
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsMediaAudioByManifestId
        /// </summary>
        /// <param name="encoding">the encoding where the resources belong to</param>
        /// <param name="manifest">the manifest where the audio playlist should be added</param>
        /// <param name="audioMuxing">the audio muxing that should be used</param>
        /// <param name="audioStream">the audio stream of the muxing</param>
        /// <param name="audioSegmentsPath">the path to the audio segments</param>
        private Task CreateAudioMediaPlaylist(
            Models.Encoding encoding,
            HlsManifest manifest,
            Muxing audioMuxing,
            Stream audioStream,
            string uri,
            string audioSegmentsPath,
            string audioGroup)
        {
            var audioMediaInfo = new AudioMediaInfo()
            {
                Name = uri,
                Uri = uri,
                GroupId = audioGroup,
                EncodingId = encoding.Id,
                StreamId = audioStream.Id,
                MuxingId = audioMuxing.Id,
                Language = "en",
                AssocLanguage = "en",
                Autoselect = false,
                IsDefault = false,
                Forced = false,
                SegmentPath = audioSegmentsPath
            };

            return _bitmovinApi.Encoding.Manifests.Hls.Media.Audio.CreateAsync(manifest.Id, audioMediaInfo);
        }

        /// <summary>
        /// Creates an HLS video playlist
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHls
        /// </summary>
        /// <param name="encoding">the encoding where the resources belong to</param>
        /// <param name="manifest">the master manifest where the video stream playlist should belong to</param>
        /// <param name="videoMuxing">the muxing that should be used</param>
        /// <param name="videoStream">the stream of the muxing</param>
        /// <param name="uri">the relative uri of the playlist file that will be generated</param>
        /// <param name="segmentPath">the path pointing to the respective video segments</param>
        private Task CreateVideoStreamPlaylist(
            Models.Encoding encoding,
            HlsManifest manifest,
            Muxing videoMuxing,
            Stream videoStream,
            string uri,
            string segmentPath,
            string audioGroup)
        {
            var streamInfo = new StreamInfo()
            {
                Uri = uri,
                EncodingId = encoding.Id,
                StreamId = videoStream.Id,
                MuxingId = videoMuxing.Id,
                Audio = audioGroup,
                SegmentPath = segmentPath
            };

            return _bitmovinApi.Encoding.Manifests.Hls.Streams.CreateAsync(manifest.Id, streamInfo);
        }

        /// <summary>
        /// Creates a DASH manifest
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
        /// </summary>
        /// <param name="name">the resource name</param>
        /// <param name="dashProfile">the DASH profile of the manifest (ON_DEMAND, LIVE)</param>
        /// <param name="output">the output of the manifest</param>
        /// <param name="outputPath"> the output path where the manifest is written to</param>
        /// <returns>the created manifest</returns>
        private Task<DashManifest> CreateDashManifest(string name, DashProfile dashProfile, Output output,
            string outputPath)
        {
            var dashManifest = new DashManifest()
            {
                Name = name,
                Profile = dashProfile,
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)}
            };

            return _bitmovinApi.Encoding.Manifests.Dash.CreateAsync(dashManifest);
        }

        /// <summary>
        /// Creates a DASH fMP4 representation.
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
        /// </summary>
        /// <param name="encoding">the encoding where the resources belong to</param>
        /// <param name="muxing">the respective audio muxing</param>
        /// <param name="dashManifest">the dash manifest to which the representation should be added</param>
        /// <param name="period">the DASH period</param>
        /// <param name="segmentPath">the path the the fMP4 segments</param>
        /// <param name="adaptationSetId">the adaptation set to which the representation should be added</param>
        private Task CreateDashFmp4Representation(
            Models.Encoding encoding,
            Fmp4Muxing muxing,
            DashManifest dashManifest,
            Period period,
            string segmentPath,
            string adaptationSetId)
        {
            var dashFmp4H264Representation = new DashFmp4Representation()
            {
                Type = DashRepresentationType.TEMPLATE,
                EncodingId = encoding.Id,
                MuxingId = muxing.Id,
                SegmentPath = segmentPath
            };

            return _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Representations.Fmp4.CreateAsync(
                dashManifest.Id, period.Id, adaptationSetId, dashFmp4H264Representation);
        }

        /// <summary>
        /// Creates a DASH CMAF representation
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsCmafByManifestIdAndPeriodIdAndAdaptationsetId
        /// </summary>
        /// <param name="encoding">the encoding where the resources belong to</param>
        /// <param name="muxing">the muxing that should be used for this representation</param>
        /// <param name="dashManifest">the dash manifest to which the representation should be added</param>
        /// <param name="period">the period to which the representation should be added</param>
        /// <param name="segmentPath">the path the the CMAF segments</param>
        /// <param name="adaptationSetId">the adaptation set to which the representation should be added</param>
        private Task CreateDashCmafRepresentation(
            Models.Encoding encoding,
            CmafMuxing muxing,
            DashManifest dashManifest,
            Period period,
            string segmentPath,
            string adaptationSetId)
        {
            var dashCmafRepresentation = new DashCmafRepresentation()
            {
                Type = DashRepresentationType.TEMPLATE,
                EncodingId = encoding.Id,
                MuxingId = muxing.Id,
                SegmentPath = segmentPath
            };
            return _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Representations.Cmaf.CreateAsync(
                dashManifest.Id, period.Id, adaptationSetId, dashCmafRepresentation);
        }

        /// <summary>
        /// Creates a DASH WEBM representation
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashPeriodsAdaptationsetsRepresentationsWebmByManifestIdAndPeriodIdAndAdaptationsetId
        /// </summary>
        /// <param name="encoding">the encoding where the resources belong to</param>
        /// <param name="muxing">the muxing that should be used for this representation</param>
        /// <param name="dashManifest">the dash manifest to which the representation should be added</param>
        /// <param name="period">the period to which the represenation should be added</param>
        /// <param name="segmentPath">the path to the WEBM segments</param>
        /// <param name="adaptationSetId">the adaptationset to which the representation should be added</param>
        private Task CreateDashWebmRepresentation(
            Models.Encoding encoding,
            WebmMuxing muxing,
            DashManifest dashManifest,
            Period period,
            string segmentPath,
            string adaptationSetId)
        {
            var dashWebmRepresentation = new DashWebmRepresentation()
            {
                Type = DashRepresentationType.TEMPLATE,
                EncodingId = encoding.Id,
                MuxingId = muxing.Id,
                SegmentPath = segmentPath
            };

            return _bitmovinApi.Encoding.Manifests.Dash.Periods.Adaptationsets.Representations.Webm.CreateAsync(
                dashManifest.Id, period.Id, adaptationSetId, dashWebmRepresentation);
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
        /// Starts the dash manifest generation process and periodically polls its status until it reaches a
        /// final state        
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDashStartByManifestId
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsDashStatusByManifestId
        /// <para />
        /// Please note that you can also use our webhooks API instead of polling the status. For more
        /// information consult the API spec:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
        /// </summary>
        /// <param name="dashManifest">The dash manifest to be started</param>
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteDashManifest(DashManifest dashManifest)
        {
            await _bitmovinApi.Encoding.Manifests.Dash.StartAsync(dashManifest.Id);

            ServiceTaskStatus task;
            do
            {
                await Task.Delay(5000);
                task = await _bitmovinApi.Encoding.Manifests.Dash.StatusAsync(dashManifest.Id);
            } while (task.Status != Status.FINISHED && task.Status != Status.ERROR);

            if (task.Status == Status.ERROR)
            {
                LogTaskErrors(task);
                throw new SystemException("Dash manifest failed");
            }

            Console.WriteLine("Dash finished successfully");
        }

        /// <summary>
        /// Starts the hls manifest generation process and periodically polls its status until it reaches a
        /// final state        
        ///
        /// API endpoints:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsStartByManifestId
        /// https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/GetEncodingManifestsHlsStatusByManifestId
        /// <para />
        /// Please note that you can also use our webhooks API instead of polling the status. For more
        /// information consult the API spec:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
        /// </summary>
        /// <param name="hlsManifest">The dash manifest to be started</param>
        /// <exception cref="System.SystemException"></exception>
        private async Task ExecuteHlsManifest(HlsManifest hlsManifest)
        {
            await _bitmovinApi.Encoding.Manifests.Hls.StartAsync(hlsManifest.Id);

            ServiceTaskStatus task;
            do
            {
                await Task.Delay(5000);
                task = await _bitmovinApi.Encoding.Manifests.Hls.StatusAsync(hlsManifest.Id);
            } while (task.Status != Status.FINISHED && task.Status != Status.ERROR);

            if (task.Status == Status.ERROR)
            {
                LogTaskErrors(task);
                throw new SystemException("Hls manifest failed");
            }

            Console.WriteLine("Hls finished successfully");
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
        private Task<H264VideoConfiguration> CreateH264VideoConfiguration(int height, long bitrate)
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
        /// Creates a base H.265 video configuration. The width of the video will be set accordingly to the
        /// aspect ratio of the source video.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH265
        /// </summary>
        private Task<H265VideoConfiguration> CreateH265VideoConfiguration(int height, long bitrate)
        {
            var config = new H265VideoConfiguration()
            {
                Name = $"H.265 {height}p",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
                Height = height,
                Bitrate = bitrate
            };

            return _bitmovinApi.Encoding.Configurations.Video.H265.CreateAsync(config);
        }

        /// <summary>
        /// Creates a base VP9 video configuration. The width of the video will be set accordingly to the
        /// aspect ratio of the source video.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoVp9
        /// </summary>
        private Task<Vp9VideoConfiguration> CreateVp9VideoConfiguration(int height, long bitrate)
        {
            var config = new Vp9VideoConfiguration()
            {
                Name = $"VP9 {height}p",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
                Height = height,
                Bitrate = bitrate
            };

            return _bitmovinApi.Encoding.Configurations.Video.Vp9.CreateAsync(config);
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
        /// Creates an AC3 audio configuration. The sample rate of the audio will be set accordingly to the
        /// sample rate of the source audio.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAc3
        /// </summary>
        private Task<Ac3AudioConfiguration> CreateAc3AudioConfiguration()
        {
            var config = new Ac3AudioConfiguration()
            {
                Name = "AC3 128 kbit/s",
                Bitrate = 128_000L
            };

            return _bitmovinApi.Encoding.Configurations.Audio.Ac3.CreateAsync(config);
        }

        /// <summary>
        /// Creates a Vorbis audio configuration. The sample rate of the audio will be set accordingly to
        /// the sample rate of the source audio.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioVorbis
        /// </summary>
        private Task<VorbisAudioConfiguration> CreateVorbisAudioConfiguration()
        {
            var config = new VorbisAudioConfiguration()
            {
                Name = "Vorbis 128 kbit/s",
                Bitrate = 128_000L
            };

            return _bitmovinApi.Encoding.Configurations.Audio.Vorbis.CreateAsync(config);
        }

        /// <summary>
        /// Creates a MP4 muxing.
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="stream">A list of streams to be added to the muxing</param>
        private Task<Fmp4Muxing> CreateFmp4Muxing(Models.Encoding encoding, Output output, string outputPath,
            Stream stream)
        {
            var muxingSteam = new MuxingStream()
            {
                StreamId = stream.Id,
            };

            var muxing = new Fmp4Muxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingSteam},
                SegmentLength = 4.0
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Fmp4.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Creates a CMAF muxing. This will generate segments with a given segment length for adaptive streaming.
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsCmafByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="stream">A list of streams to be added to the muxing</param>
        private Task<CmafMuxing> CreateCmafMuxing(Models.Encoding encoding, Output output, string outputPath,
            Stream stream)
        {
            var muxingSteam = new MuxingStream()
            {
                StreamId = stream.Id,
            };

            var muxing = new CmafMuxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingSteam},
                SegmentLength = 4.0
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Cmaf.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Creates a fragmented TS muxing. This will generate segments with a given segment length for
        /// adaptive streaming.
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsTsByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="stream">A list of streams to be added to the muxing</param>
        private Task<TsMuxing> CreateTsMuxing(Models.Encoding encoding, Output output, string outputPath,
            Stream stream)
        {
            var muxingSteam = new MuxingStream()
            {
                StreamId = stream.Id,
            };

            var muxing = new TsMuxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingSteam},
                SegmentLength = 4.0
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Ts.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Creates a fragmented TS muxing. This will generate segments with a given segment length for
        /// adaptive streaming.
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsWebmByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the muxing to</param>
        /// <param name="output">The output that should be used for the muxing to write the segments to</param>
        /// <param name="outputPath">The output path where the fragments will be written to</param>
        /// <param name="stream">A list of streams to be added to the muxing</param>
        private Task<WebmMuxing> CreateWebmMuxing(Models.Encoding encoding, Output output, string outputPath,
            Stream stream)
        {
            var muxingSteam = new MuxingStream()
            {
                StreamId = stream.Id,
            };

            var muxing = new WebmMuxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingSteam},
                SegmentLength = 4.0
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Webm.CreateAsync(encoding.Id, muxing);
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