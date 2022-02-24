<?php

/***
 * Class ConfigProvider
 *
 * This class is responsible for retrieving config values from different sources in this order:
 *
 * <ol>
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
 *   <li>properties file located in the root folder of the PHP examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */
class ConfigProvider
{
    private $configuration = [];

    public function __construct()
    {
        // parse command line arguments
        $this->configuration['Command line arguments'] = $this->parseCommandLineArguments($_SERVER['argv']);

        // parse properties from ./examples.properties
        $this->configuration['Local properties file'] = $this->parsePropertiesFile('.');

        // get environment variables
        $this->configuration["Environment Variables"] = getenv();

        // parse properties from ~/.bitmovin/examples.properties
        $this->configuration['System-wide properties file'] =
            $this->parsePropertiesFile(getenv("HOME") . DIRECTORY_SEPARATOR . '.bitmovin');
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getBitmovinApiKey(): string
    {
        return $this->getOrThrowException(
            'BITMOVIN_API_KEY', 
            'Your API key for the Bitmovin API.'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getBitmovinTenantOrgId(): string
    {
        return $this->getOrThrowException(
            'BITMOVIN_TENANT_ORG_ID', 
            'The ID of the Organisation in which you want to perform the encoding.'
        );
    }
    
    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputHost(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_HOST',
            'Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputFilePath(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_FILE_PATH',
            'The path to your Http input file. Example: videos/1080p_Sintel.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputFilePathWithMultipleMonoAudioTracks(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS',
            'The path to a file containing a video with multiple mono audio tracks. Example: videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputFilePathWithStereoSound(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_FILE_PATH_STEREO_SOUND',
            'The path and filename for a file containing a video with a single audio stereo stream. Example: videos/1080p_Sintel_Stereo.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputFilePathWithSurroundSound(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_FILE_PATH_SURROUND_SOUND',
            'The path and filename for a file containing a video with a 5.1 audio stream. Example: videos/1080p_Sintel_Surround.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputBumperFilePath(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_BUMPER_FILE_PATH',
            'The path to your Http bumper input file. Example: videos/bumper.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputPromoFilePath(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_PROMO_FILE_PATH',
            'The path to your Http promo input file. Example: videos/promo.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getHttpInputFilePathWithTwoStereoTracks(): string
    {
        return $this->getOrThrowException(
            'HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS',
            'The path to a file containing a video with 2 stereo tracks. Example: videos/1080p_Sintel_Two_Stereos.mp4'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getS3OutputBucketName(): string
    {
        return $this->getOrThrowException(
            'S3_OUTPUT_BUCKET_NAME',
            'The name of your S3 output bucket. Example: my-bucket-name'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getS3OutputAccessKey(): string
    {
        return $this->getOrThrowException('S3_OUTPUT_ACCESS_KEY', 'The access key of your S3 output bucket.');
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getS3OutputSecretKey(): string
    {
        return $this->getOrThrowException('S3_OUTPUT_SECRET_KEY', 'The secret key of your S3 output bucket.');
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getS3OutputBasePath(): string
    {
        return $this->prepareS3OutputBasePath(
            $this->getOrThrowException('S3_OUTPUT_BASE_PATH', 'The base path on your S3 output bucket. Example: /outputs')
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getWatermarkImagePath(): string
    {
        return $this->getOrThrowException(
            'WATERMARK_IMAGE_PATH',
            'The path to the watermark image. Example: http://my-storage.biz/logo.png'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getTextFilterText(): string
    {
        return $this->getOrThrowException('TEXT_FILTER_TEXT', 'The text to be displayed by the text filter.');
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getDrmKey(): string
    {
        return $this->getOrThrowException(
            'DRM_KEY',
            '16 byte encryption key, represented as 32 hexadecimal characters Example: cab5b529ae28d5cc5e3e7bc3fd4a544d'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getDrmFairplayIv(): string
    {
        return $this->getOrThrowException(
            'DRM_FAIRPLAY_IV',
            '16 byte initialization vector, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getDrmFairplayUri(): string
    {
        return $this->getOrThrowException(
            'DRM_FAIRPLAY_URI',
            'URI of the licensing server Example: skd://userspecifc?custom=information'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getDrmWidevineKid(): string
    {
        return $this->getOrThrowException(
            'DRM_WIDEVINE_KID',
            '16 byte encryption key id, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d'
        );
    }

    /**
     * @return string
     * @throws Exception
     */
    public function getDrmWidevinePssh(): string
    {
        return $this->getOrThrowException(
            'DRM_WIDEVINE_PSSH',
            'Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg=='
        );
    }

    /**
     * @param string $key
     * @return string
     * @throws Exception
     */
    public function getParameterByKey(string $key): string
    {
        return $this->getOrThrowException(
            $key,
            'Configuration Parameter ' . $key
        );
    }

    /**
     * @param string $key
     * @param string $description
     * @return string
     * @throws Exception
     */
    private function getOrThrowException(string $key, string $description): string
    {
        foreach ($this->configuration as $configurationName => $configurationProperties) {
            if (array_key_exists($key, $configurationProperties)) {
                $value = $configurationProperties[$key];
                echo 'Retrieved ' . $key . ' from ' . $configurationName . ' config source: ' . $value . PHP_EOL;
                return $value;
            }
        }

        throw new Exception("[MissingArgument] '" . $key . "' - '" . $description . "' could not find in the config source.");
    }

    private function parseCommandLineArguments(array $arguments)
    {
        $values = [];

        foreach ($arguments as $argument_num => $argument) {
            $splitted = explode("=", $argument, 2);

            if (sizeof($splitted) < 2 || $this->isNullOrEmptyString($splitted[0]) || $this->isNullOrEmptyString($splitted[1])) {
                continue;
            }

            $values[$splitted[0]] = $splitted[1];
        }

        return $values;
    }

    private function parsePropertiesFile(string $path)
    {
        $propertiesFileDirectory = $path . DIRECTORY_SEPARATOR . 'examples.properties';

        // Return an empty array if the file does not exist
        if (!file_exists($propertiesFileDirectory)) {
            return [];
        }

        $lines = file($propertiesFileDirectory, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $values = [];

        foreach ($lines as $line_num => $line) {
            if ($line[0] == '#') {
                continue;
            }
            $splitted = explode("=", $line, 2);

            // Continue if the key or the value is empty
            if (sizeof($splitted) < 2 || $this->isNullOrEmptyString($splitted[0]) || $this->isNullOrEmptyString($splitted[1])) {
                continue;
            }

            $values[$splitted[0]] = $splitted[1];
        }

        return $values;
    }

    public function isNullOrEmptyString($str)
    {
        return (!isset($str) || trim($str) === '');
    }

    private function prepareS3OutputBasePath(string $outputBasePath)
    {
        // Remove heading slash if existing and add trailing slash if missing
        return trim($outputBasePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    }
}
