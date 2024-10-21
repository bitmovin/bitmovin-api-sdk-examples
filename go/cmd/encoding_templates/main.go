package main

import (
	"bytes"
	"log"
	"text/template"
	"time"

	"github.com/bitmovin/bitmovin-api-sdk-examples/pkg/common"
	"github.com/bitmovin/bitmovin-api-sdk-go"
	"github.com/bitmovin/bitmovin-api-sdk-go/apiclient"
	"github.com/bitmovin/bitmovin-api-sdk-go/model"
)

var bitmovinApi *bitmovin.BitmovinAPI
var config common.Configuration

// This example shows how to do a Per-Title encoding with default manifests with Encoding Templates.
// For more information see: https://bitmovin.com/per-title-encoding/
//
// The following configuration parameters are expected:
//   - BITMOVIN_API_KEY - Your API key for the Bitmovin API
//   - BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
//   - HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server
//     Example: videos/1080p_Sintel.mp4
//   - S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket.
//     Example: my-bucket-name
//   - S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
//   - S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
//   - S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
//     Example: /outputs
//
// Configuration parameters will be retrieved from a file specified as a command line argument. The syntax for this
// file can be found by checking the example.properties.template file in the root directory of the GO examples.
func main() {
	var err error

	config, err = common.GetConfigProvider()
	if err != nil {
		log.Fatalf("failed to load configuration file: %v", err)
	}

	apiClient := apiclient.WithAPIKey(config.GetBitmovinApiKeyOrPanic())
	// uncomment the following line if you are working with a multi-tenant account
	// apiClient.WithTenantOrgId(config.GetBitmovinTenantOrgId())

	bitmovinApi, err = bitmovin.NewBitmovinAPI(apiClient)
	if err != nil {
		log.Fatalf("failed to create bitmovin api: %v", err)
	}

	output, err := createS3Output(config.GetS3OutputBucketName(),
		config.GetS3OutputAccessKeyOrPanic(),
		config.GetS3OutputSecretKeyOrPanic())
	if err != nil {
		log.Fatalf("failed to create output: %v", err)
	}

	// define the values for interpolation
	data := struct {
		InputFilePath  string
		OutputFilePath string
		OutputId       *string
	}{
		InputFilePath:  config.GetHttpInputFilePathOrPanic(),
		OutputFilePath: config.GetS3OutputBasePathOrPanic(),
		OutputId:       output.Id,
	}

	yamlTemplate := `metadata:
  type: VOD
  name: Standard VOD Workflow

inputs:
  https:
    streams_encoding_https_input:
      properties:
        host: bitmovin-sample-content.s3.eu-west-1.amazonaws.com
        name: Bitmovin Sample Content

configurations:
  video:
    h264:
      streams_encoding_h264:
        properties:
          name: streams_encoding_h264
          profile: MAIN
      streams_encoding_h264_1080p:
        properties:
          name: streams_encoding_h264_1080p
          profile: MAIN
          height: 1080

encodings:
  main-encoding:
    properties:
      name: Standard VOD Workflow
      encoderVersion: STABLE

    streams:
      video_h264:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: {{.InputFilePath}}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264
          mode: PER_TITLE_TEMPLATE
      video_h264_1080p:
        properties:
          inputStreams:
            - inputId: $/inputs/https/streams_encoding_https_input
              inputPath: {{.InputFilePath}}
          codecConfigId: $/configurations/video/h264/streams_encoding_h264_1080p
          mode: PER_TITLE_TEMPLATE_FIXED_RESOLUTION

    muxings:
      fmp4:
        fmp4_h264:
          properties:
            name: fmp4_h264
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264
            outputs:
              - outputId: {{.OutputId}}
                outputPath: {{.OutputFilePath}}/vod_streams_encoding/{width}_{bitrate}_{uuid}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s
        fmp4_h264_1080p:
          properties:
            name: fmp4_h264_1080p
            streamConditionsMode: DROP_MUXING
            streams:
              - streamId: $/encodings/main-encoding/streams/video_h264_1080p
            outputs:
              - outputId: {{.OutputId}}
                outputPath: {{.OutputFilePath}}/vod_streams_encoding/{bitrate}/
                acl:
                  - permission: PRIVATE
            initSegmentName: init.mp4
            segmentLength: 4
            segmentNaming: seg_%number%.m4s

    start:
      properties:
        encodingMode: THREE_PASS
        perTitle:
          h264Configuration:
            targetQualityCrf: 25
        previewDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash
        vodDashManifests:
          - manifestId: $/manifests/dash/defaultapi/default-dash

manifests:
  dash:
    defaultapi:
      default-dash:
        properties:
          encodingId: $/encodings/main-encoding
          name: Template encoding default DASH manifest
          manifestName: manifest.mpd
          profile: ON_DEMAND
          outputs:
            - outputId: {{.OutputId}}
              outputPath: {{.OutputFilePath}}/vod_streams_encoding/
              acl:
                - permission: PRIVATE
          version: V2`

	// create a new template and parse the YAML string
	tmpl, err := template.New("yaml").Parse(yamlTemplate)
	if err != nil {
		panic(err)
	}

	// Create a file to write the output or use a string builder
	var yamlString bytes.Buffer
	err = tmpl.Execute(&yamlString, data)
	if err != nil {
		panic(err)
	}

	err = ExecuteEncoding(bitmovinApi, yamlString.String())
	if err != nil {
		log.Fatalf("failed to executed encoding: %v", err)
	}
}

// Creates a resource representing an AWS S3 cloud storage bucket to which generated content will
// be transferred. For alternative output methods and a list of supported input and output storage
// see this link:
// https://bitmovin.com/docs/encoding/articles/supported-input-output-storages
//
// The provided credentials need to allow read, write and list operations.
// delete should also be granted to allow overwriting of existings files. For further information to
// create an S3 bucket and set permissions see:
// https://bitmovin.com/docs/encoding/faqs/how-do-i-create-a-aws-s3-bucket-which-can-be-used-as-output-location
//
// For reasons of simplicity, a new output resource is created on each execution of this example. In production
// use, this method should be replaced by a get call retrieving an existing resource. See here:
// https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/GetEncodingOutputsS3
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/PostEncodingOutputsS3
func createS3Output(bucketName string, accessKey string, secretKey string) (*model.S3Output, error) {
	s3Output := model.S3Output{
		BucketName: &bucketName,
		AccessKey:  &accessKey,
		SecretKey:  &secretKey,
	}

	return bitmovinApi.Encoding.Outputs.S3.Create(s3Output)
}

// Starts the actual encoding process and periodically polls its status until it reaches a final
// state
//
// <p>API endpoints:
// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
// https://developer.bitmovin.com/encoding/reference/getencodingencodingsstatusbyencodingid
//
// <p>Please note that you can also use our webhooks API instead of polling the status. For more
// information consult the API spec:
// https://developer.bitmovin.com/encoding/reference/getnotificationswebhooksencodingencodingsfinished
func ExecuteEncoding(bitmovinApi *bitmovin.BitmovinAPI, template string) error {
	result, err := bitmovinApi.Encoding.Templates.Start(template)
	if err != nil {
		return err
	}

	var task *model.ModelTask
	taskFinished := false

	for err == nil && !taskFinished {
		time.Sleep(5 * time.Second)

		task, err = bitmovinApi.Encoding.Encodings.Status(*result.EncodingId)
		log.Printf("Encoding status is %v (progress: %v%%)", task.Status, *task.Progress)

		taskFinished = task.Status == model.Status_FINISHED || task.Status == model.Status_ERROR || task.Status == model.Status_CANCELED
	}

	if err == nil {
		if task.Status == model.Status_ERROR {
			logTaskErrors(task)
		} else {
			log.Printf("Encoding %v finished successfully", *result.EncodingId)
		}
	}

	return err
}

func logTaskErrors(task *model.ModelTask) {
	for _, message := range task.Messages {
		if message.Type == model.MessageType_ERROR {
			log.Printf(*message.Text)
		}
	}
}
