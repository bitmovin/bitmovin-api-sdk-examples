package common

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

type Configuration struct {
	props map[string]string
}

const PROPERTIES_FILE = "example.properties"

const BITMOVIN_API_KEY = "BITMOVIN_API_KEY"
const BITMOVIN_TENANT_ORG_ID = "BITMOVIN_TENANT_ORG_ID"

const HTTP_INPUT_HOST = "HTTP_INPUT_HOST"
const HTTP_INPUT_FILE_PATH = "HTTP_INPUT_FILE_PATH"

const S3_OUTPUT_BUCKET_NAME = "S3_OUTPUT_BUCKET_NAME"
const S3_OUTPUT_ACCESS_KEY = "S3_OUTPUT_ACCESS_KEY"
const S3_OUTPUT_SECRET_KEY = "S3_OUTPUT_SECRET_KEY"
const S3_OUTPUT_BASE_PATH = "S3_OUTPUT_BASE_PATH"

const DRM_KEY = "DRM_KEY"
const DRM_FAIRPLAY_IV = "DRM_FAIRPLAY_IV"
const DRM_FAIRPLAY_URI = "DRM_FAIRPLAY_URI"
const DRM_WIDEVINE_KID = "DRM_WIDEVINE_KID"
const DRM_WIDEVINE_PSSH = "DRM_WIDEVINE_PSSH"

var ErrPropNotFound = fmt.Errorf("property does not exist")

func (c Configuration) getProp(key string) (string, error) {
	value, ok := c.props[key]

	var err error
	if !ok {
		err = ErrPropNotFound
	}

	return value, err
}

func (c Configuration) getPropOrPanic(key string) string {
	key, err := c.getProp(key)
	if err != nil {
		panic(fmt.Errorf("failed to get key %s: %v", key, err))
	}
	return key
}

func (c Configuration) GetBitmovinApiKeyOrPanic() string {
	return c.getPropOrPanic(BITMOVIN_API_KEY)
}

func (c Configuration) GetBitmovinTenantOrgIdOrPanic() string {
	return c.getPropOrPanic(BITMOVIN_TENANT_ORG_ID)
}

func (c Configuration) GetHttpInputHostOrPanic() string {
	return c.getPropOrPanic(HTTP_INPUT_HOST)
}

func (c Configuration) GetHttpInputFilePathOrPanic() string {
	return c.getPropOrPanic(HTTP_INPUT_FILE_PATH)
}

func (c Configuration) GetS3OutputBucketName() string {
	return c.getPropOrPanic(S3_OUTPUT_BUCKET_NAME)
}

func (c Configuration) GetS3OutputAccessKeyOrPanic() string {
	return c.getPropOrPanic(S3_OUTPUT_ACCESS_KEY)
}

func (c Configuration) GetS3OutputSecretKeyOrPanic() string {
	return c.getPropOrPanic(S3_OUTPUT_SECRET_KEY)
}

func (c Configuration) GetS3OutputBasePathOrPanic() string {
	return c.getPropOrPanic(S3_OUTPUT_BASE_PATH)
}

func (c Configuration) GetDrmKeyOrPanic() string {
	return c.getPropOrPanic(DRM_KEY)
}

func (c Configuration) GetDrmFairplayIvOrPanic() string {
	return c.getPropOrPanic(DRM_FAIRPLAY_IV)
}

func (c Configuration) GetDrmFairplayUriOrPanic() string {
	return c.getPropOrPanic(DRM_FAIRPLAY_URI)
}

func (c Configuration) GetDrmWidevineKidOrPanic() string {
	return c.getPropOrPanic(DRM_WIDEVINE_KID)
}

func (c Configuration) GetDrmWidevinePsshOrPanic() string {
	return c.getPropOrPanic(DRM_WIDEVINE_PSSH)
}

func GetConfigProvider() (Configuration, error) {
	config := Configuration{
		props: make(map[string]string),
	}

	file, err := os.Open(PROPERTIES_FILE)
	if err != nil {
		return config, err
	}

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		tokens := strings.Split(scanner.Text(), "=")
		if len(tokens) != 2 {
			continue
		}

		config.props[tokens[0]] = tokens[1]
	}

	return config, nil
}
