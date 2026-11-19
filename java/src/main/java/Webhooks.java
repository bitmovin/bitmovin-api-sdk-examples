import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.model.*;
import feign.Logger.Level;
import feign.slf4j.Slf4jLogger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Webhooks {

    private static final Logger logger = LoggerFactory.getLogger(Webhooks.class);
    private static BitmovinApi bitmovinApi;
    private static final String API_KEY = "XXX";
    private static final String WEBHOOK_URL = "https://mywebhook.com/encoding";

    public static void main(String[] args) throws Exception {
        bitmovinApi = BitmovinApi.builder()
                        .withApiKey(API_KEY)
                        .withLogger(new Slf4jLogger(), Level.BASIC)
                        .build();

        Webhook webhook = new Webhook();
        webhook.setUrl(WEBHOOK_URL);
        bitmovinApi.notifications.webhooks.encoding.encodings.finished.create(webhook);
        bitmovinApi.notifications.webhooks.encoding.encodings.error.create(webhook);

        Encoding encoding = new Encoding();
        encoding.setName("Webhook encoding");
        encoding = bitmovinApi.encoding.encodings.create(encoding);

        HttpInput input = new HttpInput();
        input.setHost("https://bitmovin-sample-content.s3.eu-west-1.amazonaws.com");
        input = bitmovinApi.encoding.inputs.http.create(input);

        StreamInput streamInput = new StreamInput();
        streamInput.setInputId(input.getId());
        streamInput.setInputPath("tears_of_steel_1080p.mov");
        streamInput.setSelectionMode(StreamSelectionMode.AUTO);

        H264VideoConfiguration codecConfig = new H264VideoConfiguration();
        codecConfig.setName("H.264 240p Webhook");
        codecConfig.setPresetConfiguration(PresetConfiguration.VOD_STANDARD);
        codecConfig.setHeight(240);
        codecConfig.setBitrate(400_000L);
        codecConfig = bitmovinApi.encoding.configurations.video.h264.create(codecConfig);

        Stream stream = new Stream();
        stream.addInputStreamsItem(streamInput);
        stream.setCodecConfigId(codecConfig.getId());
        stream = bitmovinApi.encoding.encodings.streams.create(encoding.getId(), stream);

        MuxingStream muxingStream = new MuxingStream();
        muxingStream.setStreamId(stream.getId());

        EncodingOutput encodingOutput = new EncodingOutput();
        encodingOutput.setOutputPath("video/240/");
        encodingOutput.setOutputId(getCdnOutput().getId());

        Fmp4Muxing muxing = new Fmp4Muxing();
        muxing.addOutputsItem(encodingOutput);
        muxing.addStreamsItem(muxingStream);
        muxing.setSegmentLength(4.0);
        bitmovinApi.encoding.encodings.muxings.fmp4.create(encoding.getId(), muxing);

        StartEncodingRequest startEncodingRequest = new StartEncodingRequest();
        bitmovinApi.encoding.encodings.start(encoding.getId(), startEncodingRequest);

        Task task;
        do {
            Thread.sleep(5000);
            task = bitmovinApi.encoding.encodings.status(encoding.getId());
            logger.info("Encoding status is {} (progress: {} %)", task.getStatus(), task.getProgress());
        } while (task.getStatus() != Status.FINISHED
                && task.getStatus() != Status.ERROR
                && task.getStatus() != Status.CANCELED);

        if (task.getStatus() == Status.ERROR) {
            logTaskErrors(task);
            throw new RuntimeException("Encoding failed");
        }
        logger.info("Encoding finished successfully");
    }
    
    private static CdnOutput getCdnOutput () {
        PaginationResponse<CdnOutput> outputs = bitmovinApi.encoding.outputs.cdn.list();
        return outputs.getItems().get(0);
    }

    private static void logTaskErrors(Task task) {
        task.getMessages().stream()
                .filter(msg -> msg.getType() == MessageType.ERROR)
                .forEach(msg -> logger.error(msg.getText()));
    }
}
