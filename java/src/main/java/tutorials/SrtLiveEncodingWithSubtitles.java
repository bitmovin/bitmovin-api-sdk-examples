package tutorials;

import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.model.AacAudioConfiguration;
import com.bitmovin.api.sdk.model.AclEntry;
import com.bitmovin.api.sdk.model.AclPermission;
import com.bitmovin.api.sdk.model.AudioAdaptationSet;
import com.bitmovin.api.sdk.model.AudioMediaInfo;
import com.bitmovin.api.sdk.model.ChunkedTextMuxing;
import com.bitmovin.api.sdk.model.CloudRegion;
import com.bitmovin.api.sdk.model.DashChunkedTextRepresentation;
import com.bitmovin.api.sdk.model.DashFmp4Representation;
import com.bitmovin.api.sdk.model.DashManifest;
import com.bitmovin.api.sdk.model.DashRepresentationType;
import com.bitmovin.api.sdk.model.DvbSubtitleInputStream;
import com.bitmovin.api.sdk.model.Encoding;
import com.bitmovin.api.sdk.model.EncodingOutput;
import com.bitmovin.api.sdk.model.Fmp4Muxing;
import com.bitmovin.api.sdk.model.H264VideoConfiguration;
import com.bitmovin.api.sdk.model.HlsManifest;
import com.bitmovin.api.sdk.model.LiveDashManifest;
import com.bitmovin.api.sdk.model.LiveEncoding;
import com.bitmovin.api.sdk.model.LiveHlsManifest;
import com.bitmovin.api.sdk.model.MuxingStream;
import com.bitmovin.api.sdk.model.Period;
import com.bitmovin.api.sdk.model.PresetConfiguration;
import com.bitmovin.api.sdk.model.ProfileH264;
import com.bitmovin.api.sdk.model.S3Output;
import com.bitmovin.api.sdk.model.SrtInput;
import com.bitmovin.api.sdk.model.SrtMode;
import com.bitmovin.api.sdk.model.StartLiveEncodingRequest;
import com.bitmovin.api.sdk.model.Status;
import com.bitmovin.api.sdk.model.Stream;
import com.bitmovin.api.sdk.model.StreamInfo;
import com.bitmovin.api.sdk.model.StreamInput;
import com.bitmovin.api.sdk.model.StreamSelectionMode;
import com.bitmovin.api.sdk.model.SubtitleAdaptationSet;
import com.bitmovin.api.sdk.model.SubtitlesMediaInfo;
import com.bitmovin.api.sdk.model.Task;
import com.bitmovin.api.sdk.model.TsMuxing;
import com.bitmovin.api.sdk.model.VideoAdaptationSet;
import com.bitmovin.api.sdk.model.WebVttConfiguration;
import com.bitmovin.api.sdk.model.WebVttCueIdentifierPolicy;
import common.ConfigProvider;
import feign.slf4j.Slf4jLogger;

import java.text.SimpleDateFormat;
import java.util.Date;

public class SrtLiveEncodingWithSubtitles {
  public static void main(String[] args) throws InterruptedException {
    ConfigProvider configProvider = new ConfigProvider(args);
    BitmovinApi bitmovinApi =
        BitmovinApi.builder()
            .withApiKey(configProvider.getBitmovinApiKey())
            .withLogger(new Slf4jLogger(), feign.Logger.Level.FULL)
            .build();

    SrtInput input = new SrtInput();
    input.setName("MyLiveSrtInput");
    input.setMode(SrtMode.LISTENER);
    input.setPort(2088);
    input = bitmovinApi.encoding.inputs.srt.create(input);

    S3Output s3Output = new S3Output();
    s3Output.setName("MyLiveS3Output");
    s3Output.setBucketName(configProvider.getS3OutputBucketName());
    s3Output.setAccessKey(configProvider.getS3OutputAccessKey());
    s3Output.setSecretKey(configProvider.getS3OutputSecretKey());
    s3Output = bitmovinApi.encoding.outputs.s3.create(s3Output);

    String outputBasePath =
        String.format(
            "/live-encoding-with-subtitles/%s/",
            new SimpleDateFormat("yyyy-MM-dd-HH-mm-ss").format(new Date()));

    AclEntry publicAclEntry = new AclEntry();
    publicAclEntry.setPermission(AclPermission.PUBLIC_READ);

    // Encoding
    Encoding encoding = new Encoding();
    encoding.setCloudRegion(CloudRegion.AUTO);
    encoding.setName("My SRT Live Encoding with subtitles");
    encoding = bitmovinApi.encoding.encodings.create(encoding);

    // Audio
    AacAudioConfiguration aacAudioConfig = new AacAudioConfiguration();
    aacAudioConfig.setName("MyLiveAACConfig");
    aacAudioConfig.setBitrate(128_000L);
    aacAudioConfig = bitmovinApi.encoding.configurations.audio.aac.create(aacAudioConfig);

    StreamInput audioStreamInput = new StreamInput();
    audioStreamInput.setInputId(input.getId());
    audioStreamInput.setInputPath("/");
    audioStreamInput.setSelectionMode(StreamSelectionMode.POSITION_ABSOLUTE);
    audioStreamInput.setPosition(1);

    Stream audioStream = new Stream();
    audioStream.setName("Live Audio Stream");
    audioStream.addInputStreamsItem(audioStreamInput);
    audioStream.setCodecConfigId(aacAudioConfig.getId());
    audioStream = bitmovinApi.encoding.encodings.streams.create(encoding.getId(), audioStream);

    MuxingStream audioMuxingStream = new MuxingStream();
    audioMuxingStream.setStreamId(audioStream.getId());

    EncodingOutput audioSegmentsOutput = new EncodingOutput();
    audioSegmentsOutput.addAclItem(publicAclEntry);
    audioSegmentsOutput.setOutputPath(outputBasePath + "audio");
    audioSegmentsOutput.setOutputId(s3Output.getId());

    // TS audio Muxing
    TsMuxing audioTsMuxing = new TsMuxing();
    audioTsMuxing.addStreamsItem(audioMuxingStream);
    audioTsMuxing.setSegmentNaming("audio_%number%.ts");
    audioTsMuxing.setSegmentLength(4.0);
    audioTsMuxing.addOutputsItem(audioSegmentsOutput);
    audioTsMuxing =
        bitmovinApi.encoding.encodings.muxings.ts.create(encoding.getId(), audioTsMuxing);

    // FMP4 audio Muxing
    Fmp4Muxing audioFmp4Muxing = new Fmp4Muxing();
    audioFmp4Muxing.setSegmentLength(4.0);
    audioFmp4Muxing.addStreamsItem(audioMuxingStream);
    audioFmp4Muxing.addOutputsItem(audioSegmentsOutput);
    audioFmp4Muxing.setSegmentNaming("audio_%number%.m4s");
    audioFmp4Muxing =
        bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), audioFmp4Muxing);
    // end Audio

    // Video
    H264VideoConfiguration h264VideoConfig720p = new H264VideoConfiguration();
    h264VideoConfig720p.setName("Live H264 video config 720p");
    h264VideoConfig720p.setProfile(ProfileH264.HIGH);
    h264VideoConfig720p.setBitrate(2700_000L);
    h264VideoConfig720p.setHeight(720);
    h264VideoConfig720p.setPresetConfiguration(PresetConfiguration.LIVE_LOWER_LATENCY);
    h264VideoConfig720p =
        bitmovinApi.encoding.configurations.video.h264.create(h264VideoConfig720p);

    StreamInput videoStreamInput = new StreamInput();
    videoStreamInput.setInputId(input.getId());
    videoStreamInput.setInputPath("/");
    videoStreamInput.setSelectionMode(StreamSelectionMode.POSITION_ABSOLUTE);
    videoStreamInput.setPosition(0);

    Stream videoStream = new Stream();
    videoStream.setName("Live video Stream");
    videoStream.addInputStreamsItem(videoStreamInput);
    videoStream.setCodecConfigId(h264VideoConfig720p.getId());
    videoStream = bitmovinApi.encoding.encodings.streams.create(encoding.getId(), videoStream);

    MuxingStream videoMuxingStream = new MuxingStream();
    videoMuxingStream.setStreamId(videoStream.getId());

    EncodingOutput videoSegmentsOutput = new EncodingOutput();
    videoSegmentsOutput.addAclItem(publicAclEntry);
    videoSegmentsOutput.setOutputPath(outputBasePath + "video");
    videoSegmentsOutput.setOutputId(s3Output.getId());

    // TS video Muxing
    TsMuxing videoTsMuxing = new TsMuxing();
    videoTsMuxing.addStreamsItem(videoMuxingStream);
    videoTsMuxing.setSegmentNaming("video_%number%.ts");
    videoTsMuxing.setSegmentLength(4.0);
    videoTsMuxing.addOutputsItem(videoSegmentsOutput);
    videoTsMuxing =
        bitmovinApi.encoding.encodings.muxings.ts.create(encoding.getId(), videoTsMuxing);

    // FMP4 video Muxing
    Fmp4Muxing videoFmp4Muxing = new Fmp4Muxing();
    videoFmp4Muxing.setSegmentLength(4.0);
    videoFmp4Muxing.addStreamsItem(videoMuxingStream);
    videoFmp4Muxing.setSegmentNaming("video_%number%.m4s");
    videoFmp4Muxing.addOutputsItem(videoSegmentsOutput);
    videoFmp4Muxing =
        bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), videoFmp4Muxing);
    // end Video

    // Subtitle
    DvbSubtitleInputStream dvbSubtitleInputStream = new DvbSubtitleInputStream();
    dvbSubtitleInputStream.setInputId(input.getId());
    dvbSubtitleInputStream.setInputPath("/");
    dvbSubtitleInputStream.setPosition(4);
    dvbSubtitleInputStream.setSelectionMode(StreamSelectionMode.POSITION_ABSOLUTE);

    dvbSubtitleInputStream =
        bitmovinApi.encoding.encodings.inputStreams.subtitles.dvbSubtitle.create(
            encoding.getId(), dvbSubtitleInputStream);

    WebVttConfiguration webVttConfig = new WebVttConfiguration();
    webVttConfig.setCueIdentifierPolicy(WebVttCueIdentifierPolicy.OMIT_IDENTIFIERS);
    webVttConfig.setAppendOptionalZeroHour(true);
    webVttConfig = bitmovinApi.encoding.configurations.subtitles.webvtt.create(webVttConfig);

    StreamInput subtitleInputStream = new StreamInput();
    subtitleInputStream.setInputStreamId(dvbSubtitleInputStream.getId());

    Stream subtitleStream = new Stream();
    subtitleStream.addInputStreamsItem(subtitleInputStream);
    subtitleStream.setCodecConfigId(webVttConfig.getId());
    subtitleStream =
        bitmovinApi.encoding.encodings.streams.create(encoding.getId(), subtitleStream);

    EncodingOutput subtitlesOutput = new EncodingOutput();
    subtitlesOutput.addAclItem(publicAclEntry);
    subtitlesOutput.setOutputPath(outputBasePath + "subtitles/");
    subtitlesOutput.setOutputId(s3Output.getId());

    MuxingStream subtitleMuxingStream = new MuxingStream();
    subtitleMuxingStream.setStreamId(subtitleStream.getId());

    ChunkedTextMuxing chunkedTextMuxing = new ChunkedTextMuxing();
    chunkedTextMuxing.setSegmentNaming("webvtt_seg_%number%.vtt");
    chunkedTextMuxing.setSegmentLength(10.0);
    chunkedTextMuxing.setName("Chunked Text Muxing");
    chunkedTextMuxing.addOutputsItem(subtitlesOutput);
    chunkedTextMuxing.addStreamsItem(subtitleMuxingStream);

    chunkedTextMuxing =
        bitmovinApi.encoding.encodings.muxings.chunkedText.create(
            encoding.getId(), chunkedTextMuxing);
    // end Subtitle

    // DASH Manifest
    EncodingOutput manifestOutput = new EncodingOutput();
    manifestOutput.setOutputId(s3Output.getId());
    manifestOutput.addAclItem(publicAclEntry);
    manifestOutput.setOutputPath(outputBasePath);

    DashManifest dashManifest = new DashManifest();
    dashManifest.setName("live.mpd");
    dashManifest.setManifestName("live.mpd");
    dashManifest.addOutputsItem(manifestOutput);
    dashManifest = bitmovinApi.encoding.manifests.dash.create(dashManifest);

    Period period = new Period();
    period = bitmovinApi.encoding.manifests.dash.periods.create(dashManifest.getId(), period);

    // AudioAdaptationSet
    AudioAdaptationSet audioAdaptationSet = new AudioAdaptationSet();
    audioAdaptationSet =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.audio.create(
            dashManifest.getId(), period.getId(), audioAdaptationSet);

    DashFmp4Representation audioRepresentation = new DashFmp4Representation();
    audioRepresentation.setEncodingId(encoding.getId());
    audioRepresentation.setMuxingId(audioFmp4Muxing.getId());
    audioRepresentation.setSegmentPath("audio");
    audioRepresentation.setType(DashRepresentationType.TEMPLATE);
    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
        dashManifest.getId(), period.getId(), audioAdaptationSet.getId(), audioRepresentation);

    // VideoAdaptationSet
    VideoAdaptationSet videoAdaptationSet = new VideoAdaptationSet();
    videoAdaptationSet =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.video.create(
            dashManifest.getId(), period.getId(), videoAdaptationSet);

    DashFmp4Representation videoRepresentation = new DashFmp4Representation();
    videoRepresentation.setEncodingId(encoding.getId());
    videoRepresentation.setMuxingId(videoFmp4Muxing.getId());
    videoRepresentation.setSegmentPath("video");
    videoRepresentation.setType(DashRepresentationType.TEMPLATE);

    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
        dashManifest.getId(), period.getId(), videoAdaptationSet.getId(), videoRepresentation);

    // SubtitleAdaptationSet
    SubtitleAdaptationSet subtitleAdaptationSet = new SubtitleAdaptationSet();
    subtitleAdaptationSet.setLang("en");
    subtitleAdaptationSet =
        bitmovinApi.encoding.manifests.dash.periods.adaptationsets.subtitle.create(
            dashManifest.getId(), period.getId(), subtitleAdaptationSet);

    DashChunkedTextRepresentation chunkedTextRepresentation = new DashChunkedTextRepresentation();
    chunkedTextRepresentation.setEncodingId(encoding.getId());
    chunkedTextRepresentation.setMuxingId(chunkedTextMuxing.getId());
    chunkedTextRepresentation.setSegmentPath("subtitles");
    chunkedTextRepresentation.setType(DashRepresentationType.TEMPLATE);

    bitmovinApi.encoding.manifests.dash.periods.adaptationsets.representations.chunkedText.create(
        dashManifest.getId(),
        period.getId(),
        subtitleAdaptationSet.getId(),
        chunkedTextRepresentation);

    LiveDashManifest liveDashManifest = new LiveDashManifest();
    liveDashManifest.setManifestId(dashManifest.getId());
    // end DASH Manifest

    // HLS Manifest
    HlsManifest hlsManifest = new HlsManifest();
    hlsManifest.setName("live.m3u8");
    hlsManifest.addOutputsItem(manifestOutput);
    hlsManifest.setManifestName("live.m3u8");
    hlsManifest = bitmovinApi.encoding.manifests.hls.create(hlsManifest);

    AudioMediaInfo audioMediaInfo = new AudioMediaInfo();
    audioMediaInfo.setEncodingId(encoding.getId());
    audioMediaInfo.setStreamId(audioStream.getId());
    audioMediaInfo.setMuxingId(audioTsMuxing.getId());
    audioMediaInfo.setUri("audio.m3u8");
    audioMediaInfo.setSegmentPath("audio");
    audioMediaInfo.setGroupId("en");
    audioMediaInfo.setName("en");

    bitmovinApi.encoding.manifests.hls.media.audio.create(hlsManifest.getId(), audioMediaInfo);

    SubtitlesMediaInfo subtitleMediaInfo = new SubtitlesMediaInfo();
    subtitleMediaInfo.setName("Subtitles Media Info");
    subtitleMediaInfo.setUri("subtitles.m3u8");
    subtitleMediaInfo.setEncodingId(encoding.getId());
    subtitleMediaInfo.setStreamId(subtitleStream.getId());
    subtitleMediaInfo.setMuxingId(chunkedTextMuxing.getId());
    subtitleMediaInfo.setLanguage("English");
    subtitleMediaInfo.setAssocLanguage("en");
    subtitleMediaInfo.setSegmentPath("subtitles");
    subtitleMediaInfo.setGroupId("subtitle");
    bitmovinApi.encoding.manifests.hls.media.subtitles.create(
        hlsManifest.getId(), subtitleMediaInfo);

    StreamInfo videoStreamInfo = new StreamInfo();
    videoStreamInfo.setEncodingId(encoding.getId());
    videoStreamInfo.setStreamId(videoStream.getId());
    videoStreamInfo.setMuxingId(videoTsMuxing.getId());
    videoStreamInfo.setUri("video-720p.m3u8");
    videoStreamInfo.setSegmentPath("video");
    videoStreamInfo.setAudio("en");
    videoStreamInfo.setSubtitles("subtitle");

    bitmovinApi.encoding.manifests.hls.streams.create(hlsManifest.getId(), videoStreamInfo);

    LiveHlsManifest liveHlsManifest = new LiveHlsManifest();
    liveHlsManifest.setManifestId(hlsManifest.getId());
    // end HLS Manifest

    StartLiveEncodingRequest startRequest = new StartLiveEncodingRequest();
    startRequest.addDashManifestsItem(liveDashManifest);
    startRequest.addHlsManifestsItem(liveHlsManifest);

    bitmovinApi.encoding.encodings.live.start(encoding.getId(), startRequest);
    String encodingId = encoding.getId();

    int maxMinutesToWaitForEncodingToRun = 5;

    Status encodingStatus;
    int checkIntervalInSeconds = 10;
    int maxMinutesToWaitForLiveEncodingDetails = 5;
    int maxAttempts = maxMinutesToWaitForLiveEncodingDetails * (60 / checkIntervalInSeconds);
    int attempt = 0;

    do {
      Task encodingTask = bitmovinApi.encoding.encodings.status(encodingId);
      encodingStatus = encodingTask.getStatus();
      Thread.sleep(checkIntervalInSeconds * 1000L);
      attempt++;
    } while (!Status.RUNNING.equals(encodingStatus) && attempt < maxAttempts);

    if (attempt > maxAttempts && !Status.RUNNING.equals(encodingStatus)) {
      throw new IllegalStateException(
          String.format(
              "Encoding is not running after %d minutes! Encoding has to be in state RUNNING to stream content to it but encoding has state %s",
              maxMinutesToWaitForEncodingToRun, encodingStatus));
    }

    LiveEncoding liveEncodingResponse = bitmovinApi.encoding.encodings.live.get(encoding.getId());
    System.out.printf("Successfully started live encoding! (id: %s)%n", encoding.getId());
    System.out.printf(
        "SRT input URL: srt://%s:%d%n", liveEncodingResponse.getEncoderIp(), input.getPort());
  }
}
