package tutorials;

import com.bitmovin.api.sdk.BitmovinApi;
import com.bitmovin.api.sdk.model.LiveEncoding;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveCloudRegion;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobAccessKeyCredentials;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobInput;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobInputType;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobRequest;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobResponse;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobStatus;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveJobUrlOutput;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveMaxResolution;
import com.bitmovin.api.sdk.model.SimpleEncodingLiveProfile;
import common.ConfigProvider;
import feign.slf4j.Slf4jLogger;

import java.text.SimpleDateFormat;
import java.util.Date;

public class SrtLiveEncodingUsingSimpleApi {
  public static void main(String[] args) throws InterruptedException {
    ConfigProvider configProvider = new ConfigProvider(args);
    BitmovinApi bitmovinApi =
        BitmovinApi.builder()
            .withApiKey(configProvider.getBitmovinApiKey())
            .withLogger(new Slf4jLogger(), feign.Logger.Level.FULL)
            .build();

    SimpleEncodingLiveJobInput input = new SimpleEncodingLiveJobInput();
    input.setInputType(SimpleEncodingLiveJobInputType.SRT_LISTENER);

    SimpleEncodingLiveJobUrlOutput output = new SimpleEncodingLiveJobUrlOutput();
    output.setUrl(
        String.format(
            "s3://%s/simple-api-srt-live-encoding-%s",
            configProvider.getS3OutputBucketName(),
            new SimpleDateFormat("yyyy-MM-dd-HH-mm-ss").format(new Date())));

    SimpleEncodingLiveJobAccessKeyCredentials outputCredentials =
        new SimpleEncodingLiveJobAccessKeyCredentials();
    outputCredentials.setAccessKey(configProvider.getS3OutputAccessKey());
    outputCredentials.setSecretKey(configProvider.getS3OutputSecretKey());

    output.setCredentials(outputCredentials);
    output.setMakePublic(true);
    output.setMaxResolution(SimpleEncodingLiveMaxResolution.FULL_HD);

    SimpleEncodingLiveJobRequest job = new SimpleEncodingLiveJobRequest();
    job.setInput(input);
    job.addOutputsItem(output);
    job.setName("My simple API SRT live encoding!");
    job.setCloudRegion(SimpleEncodingLiveCloudRegion.EUROPE);
    job.setEncodingProfile(SimpleEncodingLiveProfile.LOWER_LATENCY);

    int maxMinutesToWaitForEncodingToRun = 5;
    int checkIntervalInSeconds = 10;
    int maxMinutesToWaitForLiveEncodingDetails = 5;
    int maxAttempts = maxMinutesToWaitForLiveEncodingDetails * (60 / checkIntervalInSeconds);
    int attempt = 0;

    SimpleEncodingLiveJobResponse jobResponse = bitmovinApi.encoding.simple.jobs.live.create(job);
    SimpleEncodingLiveJobStatus status;

    do {
      jobResponse = bitmovinApi.encoding.simple.jobs.live.get(jobResponse.getId());
      status = jobResponse.getStatus();
      Thread.sleep(checkIntervalInSeconds * 1000L);
      attempt++;
    } while (!SimpleEncodingLiveJobStatus.RUNNING.equals(status) && attempt < maxAttempts);

    if (attempt > maxAttempts && !SimpleEncodingLiveJobStatus.RUNNING.equals(status)) {
      throw new IllegalStateException(
          String.format(
              "Encoding is not running after %d minutes! Encoding has to be in state RUNNING to stream content to it but encoding has state %s",
              maxMinutesToWaitForEncodingToRun, status));
    }

    LiveEncoding liveEncodingResponse =
        bitmovinApi.encoding.encodings.live.get(jobResponse.getEncodingId());
    System.out.printf("Successfully started live encoding! (id: %s)%n", jobResponse.getEncodingId());

    String srtInputUrl = String.format("SRT input URL: srt://%s:2088%n", liveEncodingResponse.getEncoderIp());
    System.out.printf("SRT input URL: %s%n", srtInputUrl);
  }
}
