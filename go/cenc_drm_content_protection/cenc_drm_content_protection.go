package main

import (
	"fmt"
	"log"
	"path/filepath"
	"reflect"

	"github.com/bitmovin/bitmovin-api-sdk-examples/pkg/common"
	"github.com/bitmovin/bitmovin-api-sdk-go"
	"github.com/bitmovin/bitmovin-api-sdk-go/apiclient"
	"github.com/bitmovin/bitmovin-api-sdk-go/model"
)

var bitmovinApi *bitmovin.BitmovinAPI
var config common.Configuration

// This example shows how DRM content protection can be applied to a fragmented MP4 muxing. The encryption is
// configured to be compatible with both FairPlay and Widevine, using the MPEG-CENC standard.
//
// The following configuration parameters are expected:
//   - BITMOVIN_API_KEY - Your API key for the Bitmovin API
//   - BITMOVIN_TENANT_ORG_ID - (optional) The ID of the Organisation in which you want to perform the encoding.
//   - HTTP_INPUT_HOST - The Hostname or IP address of the HTTP server hosting your input files
//     Example: my-storage.biz
//   - HTTP_INPUT_FILE_PATH - The path to your input file on the provided HTTP server
//     Example: videos/1080p_Sintel.mp4
//   - S3_OUTPUT_BUCKET_NAME - The name of your S3 output bucket.
//     Example: my-bucket-name
//   - S3_OUTPUT_ACCESS_KEY - The access key of your S3 output bucket
//   - S3_OUTPUT_SECRET_KEY - The secret key of your S3 output bucket
//   - S3_OUTPUT_BASE_PATH - The base path on your S3 output bucket where content will be written.
//     Example: /outputs
//   - DRM_KEY - 16 byte encryption key, represented as 32 hexadecimal characters
//     Example: cab5b529ae28d5cc5e3e7bc3fd4a544d
//   - DRM_FAIRPLAY_IV - 16 byte initialization vector, represented as 32 hexadecimal characters
//     Example: 08eecef4b026deec395234d94218273d
//   - DRM_FAIRPLAY_URI - URI of the licensing server
//     Example: skd://userspecifc?custom=information
//   - DRM_WIDEVINE_KID - 16 byte encryption key id, represented as 32 hexadecimal characters
//     Example: 08eecef4b026deec395234d94218273d
//   - DRM_WIDEVINE_PSSH - Base64 encoded PSSH payload
//     Example: QWRvYmVhc2Rmc2FkZmFzZg==
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

	encoding, err := createEncoding("fMP4 muxing with CENC DRM", "Example with CENC DRM content protection")
	if err != nil {
		log.Fatalf("failed to create encoding: %v", err)
	}

	input, err := createHttpInput(config.GetHttpInputHostOrPanic())
	if err != nil {
		log.Fatalf("failed to create input: %v", err)
	}

	output, err := createS3Output(config.GetS3OutputBucketName(),
		config.GetS3OutputAccessKeyOrPanic(),
		config.GetS3OutputSecretKeyOrPanic())
	if err != nil {
		log.Fatalf("failed to create output: %v", err)
	}

	h264Config, err := createH264VideoConfig()
	if err != nil {
		log.Fatalf("failed to create video config: %v", err)
	}

	aacConfig, err := createAacAudioConfig()
	if err != nil {
		log.Fatalf("failed to create audio config: %v", err)
	}

	videoStream, err := createStream(*encoding, input, config.GetHttpInputFilePathOrPanic(), h264Config)
	if err != nil {
		log.Fatalf("failed to create video stream: %v", err)
	}

	audioStream, err := createStream(*encoding, input, config.GetHttpInputFilePathOrPanic(), aacConfig)
	if err != nil {
		log.Fatalf("failed to create audio stream: %v", err)
	}

	videoMuxing, err := createFmp4Muxing(*encoding, *videoStream)
	if err != nil {
		log.Fatalf("failed to create video muxing: %v", err)
	}

	audioMuxing, err := createFmp4Muxing(*encoding, *audioStream)
	if err != nil {
		log.Fatalf("failed to create audio muxing: %v", err)
	}

	_, err = createDrmConfig(*encoding, *videoMuxing, *output, "video")
	if err != nil {
		log.Fatalf("failed to create video drm: %v", err)
	}
	_, err = createDrmConfig(*encoding, *audioMuxing, *output, "audio")
	if err != nil {
		log.Fatalf("failed to create audio drm: %v", err)
	}

	dashManifest, err := createDefaultDashManifest(*encoding, *output, "/")
	if err != nil {
		log.Fatalf("failed to create default dash manifest: %v", err)
	}

	hlsManifest, err := createDefaultHlsManifest(*encoding, *output, "/")
	if err != nil {
		log.Fatalf("failed to create default hls manifest: %v", err)
	}

	startEncodingRequest := model.StartEncodingRequest{
		ManifestGenerator: model.ManifestGenerator_V2,
		VodDashManifests: []model.ManifestResource{{
			ManifestId: dashManifest.Id,
		}},
		VodHlsManifests: []model.ManifestResource{{
			ManifestId: hlsManifest.Id,
		}},
	}

	err = common.ExecuteEncoding(bitmovinApi, *encoding, startEncodingRequest)
	if err != nil {
		log.Fatalf("failed to executed encoding: %v", err)
	}
}

// Creates an Encoding object. This is the base object to configure your encoding. The name helps
// you identify the encoding in our dashboard (required). The description (optional) helps further
// identify the encoding.
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
func createEncoding(name string, description string) (*model.Encoding, error) {
	encoding := model.Encoding{
		Name:        &name,
		Description: &description,
	}

	return bitmovinApi.Encoding.Encodings.Create(encoding)
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

// Creates a resource representing an HTTP server providing the input files. For alternative input methods and a
// list of supported input and output storage see this link:
// https://bitmovin.com/docs/encoding/articles/supported-input-output-storages
//
// For reasons of simplicity, a new input resource is created on each execution of this example. In production
// use, this method should be replaced by a get call retrieving an existing resource. See here:
// https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp
func createHttpInput(host string) (*model.HttpInput, error) {
	input := model.HttpInput{
		Host: &host,
	}

	return bitmovinApi.Encoding.Inputs.Http.Create(input)
}

// Creates a configuration for the H.264 video codec to be applied to video streams. The output resolution is defined
// by setting the height to 1080 pixels. Width will be determined automatically to maintain the aspect ratio of your
// input video.
//
// To keep things simple, we use a quality-optimized VoD preset configuration, which will apply proven settings for
// the codec. To get information on alternative presets please see this link:
// https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
func createH264VideoConfig() (*model.H264VideoConfiguration, error) {
	name := "H.264 1080p 1.5 Mbit/s"
	height := int32(1080)
	bitrate := int64(1_500_000)

	config := model.H264VideoConfiguration{
		Name:                &name,
		PresetConfiguration: model.PresetConfiguration_VOD_STANDARD,
		Height:              &height,
		Bitrate:             &bitrate,
	}

	return bitmovinApi.Encoding.Configurations.Video.H264.Create(config)
}

// Creates a configuration for the AAC audio codec to be applied to audio streams.
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
func createAacAudioConfig() (*model.AacAudioConfiguration, error) {
	name := "AAC 128 kbit/s"
	bitrate := int64(128_000)

	config := model.AacAudioConfiguration{
		Name:    &name,
		Bitrate: &bitrate,
	}

	return bitmovinApi.Encoding.Configurations.Audio.Aac.Create(config)
}

// Adds a video or audio stream to an encoding
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
func createStream(encoding model.Encoding, input model.Input, inputPath string, codecConfiguration model.CodecConfiguration) (*model.Stream, error) {
	httpInput, ok := input.(*model.HttpInput)
	if !ok {
		return nil, fmt.Errorf("unrecognized input type: %v", reflect.TypeOf(input).String())
	}
	var codecConfigId *string
	if h264Config, ok := codecConfiguration.(*model.H264VideoConfiguration); ok {
		codecConfigId = h264Config.Id
	} else if aacConfig, ok := codecConfiguration.(*model.AacAudioConfiguration); ok {
		codecConfigId = aacConfig.Id
	} else {
		return nil, fmt.Errorf("unrecognized codec configuration: %v", reflect.TypeOf(codecConfiguration).String())
	}

	streamInput := model.StreamInput{
		InputId:       httpInput.Id,
		InputPath:     &inputPath,
		SelectionMode: model.StreamSelectionMode_AUTO,
	}

	stream := model.Stream{
		InputStreams:  []model.StreamInput{streamInput},
		CodecConfigId: codecConfigId,
		Mode:          model.StreamMode_STANDARD,
	}

	return bitmovinApi.Encoding.Encodings.Streams.Create(*encoding.Id, stream)
}

// Creates a fragmented MP4 muxing. This will split the output into continuously numbered segments of a given length for
// adaptive streaming. However, the unencrypted segments will not be written to a permanent storage as there's no output
// defined for the muxing. Instead, an output needs to be defined for the DRM configuration resource which will later be
// added to this muxing.
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
func createFmp4Muxing(encoding model.Encoding, stream model.Stream) (*model.Fmp4Muxing, error) {
	muxingStream := model.MuxingStream{
		StreamId: stream.Id,
	}

	segmentLength := float64(4.0)

	muxing := model.Fmp4Muxing{
		SegmentLength: &segmentLength,
		Streams:       []model.MuxingStream{muxingStream},
	}

	return bitmovinApi.Encoding.Encodings.Muxings.Fmp4.Create(*encoding.Id, muxing)
}

// Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will be written to. Public
// read permissions will be set for the files written, so they can be accessed easily via HTTP.
func buildEncodingOutput(output model.Output, outputPath string) (*model.EncodingOutput, error) {
	aclEntry := model.AclEntry{
		Permission: model.AclPermission_PUBLIC_READ,
	}

	baseOutput, ok := output.(model.S3Output)
	if !ok {
		return nil, fmt.Errorf("unrecognized output type: %v", reflect.TypeOf(output).String())
	}

	fullOutputPath := filepath.Join(config.GetS3OutputBasePathOrPanic(), "cenc_drm_content_protection", outputPath)
	encodingOutput := model.EncodingOutput{
		OutputId:   baseOutput.Id,
		OutputPath: &fullOutputPath,
		Acl:        []model.AclEntry{aclEntry},
	}

	return &encodingOutput, nil
}

// Adds an MPEG-CENC DRM configuration to the muxing to encrypt its output. Widevine and FairPlay specific fields will be
// included into DASH and HLS manifests to enable key retrieval using either DRM method.
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsMuxingsFmp4DrmCencByEncodingIdAndMuxingId
func createDrmConfig(encoding model.Encoding, muxing model.Muxing, output model.Output, outputPath string) (*model.CencDrm, error) {
	pssh := config.GetDrmWidevinePsshOrPanic()
	widevineDrm := model.CencWidevine{
		Pssh: &pssh,
	}

	iv := config.GetDrmFairplayIvOrPanic()
	uri := config.GetDrmFairplayUriOrPanic()
	cencFairPlay := model.CencFairPlay{
		Iv:  &iv,
		Uri: &uri,
	}

	key := config.GetDrmKeyOrPanic()
	kid := config.GetDrmWidevineKidOrPanic()
	encodingOutput, err := buildEncodingOutput(output, outputPath)
	if err != nil {
		return nil, err
	}
	cencDrm := model.CencDrm{
		Key:      &key,
		Kid:      &kid,
		Outputs:  []model.EncodingOutput{*encodingOutput},
		Widevine: &widevineDrm,
		FairPlay: &cencFairPlay,
	}

	fmp4Muxing, ok := muxing.(model.Fmp4Muxing)
	if !ok {
		return nil, fmt.Errorf("unrecognized muxing type: %v", reflect.TypeOf(muxing).String())
	}

	return bitmovinApi.Encoding.Encodings.Muxings.Fmp4.Drm.Cenc.Create(*encoding.Id, *fmp4Muxing.Id, cencDrm)
}

// Creates a DASH default manifest that automatically includes all representations configured in the encoding.
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsDash
func createDefaultDashManifest(encoding model.Encoding, output model.Output, outputPath string) (*model.DashManifestDefault, error) {
	manifestName := "stream.mpd"

	encodingOutput, err := buildEncodingOutput(output, outputPath)
	if err != nil {
		return nil, err
	}

	dashManifestDefault := model.DashManifestDefault{
		ManifestName: &manifestName,
		EncodingId:   encoding.Id,
		Version:      model.DashManifestDefaultVersion_V1,
		Outputs:      []model.EncodingOutput{*encodingOutput},
	}

	return bitmovinApi.Encoding.Manifests.Dash.Default.Create(dashManifestDefault)
}

// Creates an HLS default manifest that automatically includes all representations configured in the encoding.
//
// API endpoint: https://bitmovin.com/docs/encoding/api-reference/sections/manifests#/Encoding/PostEncodingManifestsHlsDefault
func createDefaultHlsManifest(encoding model.Encoding, output model.Output, outputPath string) (*model.HlsManifestDefault, error) {
	manifestName := "master.m3u8"

	encodingOutput, err := buildEncodingOutput(output, outputPath)
	if err != nil {
		return nil, err
	}

	hlsManifestDefault := model.HlsManifestDefault{
		ManifestName: &manifestName,
		EncodingId:   encoding.Id,
		Version:      model.HlsManifestDefaultVersion_V1,
		Outputs:      []model.EncodingOutput{*encodingOutput},
	}

	return bitmovinApi.Encoding.Manifests.Hls.Default.Create(hlsManifestDefault)
}
