using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;

namespace Bitmovin.Api.Sdk.Examples.common
{
    public class ConfigProvider
    {
        private readonly OrderedDictionary _configuration = new OrderedDictionary();

        public ConfigProvider(string[] args)
        {
            // parse command line arguments
            _configuration.Add("Command line arguments", ParseCliArguments(args));

            // parse properties from ./examples.properties
            _configuration.Add("Local properties file", ParsePropertiesFile("."));

            // parse environment variables
            _configuration.Add("Environment variables", ParseEnvironmentVariables());

            _configuration.Add("System-wide properties file",
                ParsePropertiesFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".bitmovin")));
        }

        public string GetBitmovinApiKey()
        {
            return GetOrThrowException("BITMOVIN_API_KEY",
                "Your API key for the Bitmovin API.");
        }

        public string GetBitmovinTenantOrgId()
        {
            return GetOrThrowException("BITMOVIN_TENANT_ORG_ID",
                "The ID of the Organisation in which you want to perform the encoding.");
        }

        public string GetHttpInputHost()
        {
            return GetOrThrowException("HTTP_INPUT_HOST",
                "Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz");
        }

        public string GetHttpInputFilePath()
        {
            return GetOrThrowException("HTTP_INPUT_FILE_PATH",
                "The path to your Http input file. Example: videos/1080p_Sintel.mp4");
        }

        public string GetHttpInputFilePathWithStereoSound()
        {
            return GetOrThrowException("HTTP_INPUT_FILE_PATH_STEREO_SOUND",
            "The path and filename for a file containing a video with a single audio stereo stream. Example: videos/1080p_Sintel_Stereo.mp4");
        }
        
        public string GetHttpInputFilePathWithSurroundSound()
        {
            return GetOrThrowException("HTTP_INPUT_FILE_PATH_SURROUND_SOUND",
                "The path and filename for a file containing a video with a 5.1 audio stream. Example: videos/1080p_Sintel_Surround.mp4");
        }

        public string GetHttpInputFilePathWithTwoStereoTracks()
        {
            return GetOrThrowException("HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS",
                "The path to a file containing a video with 2 stereo tracks. " +
                "Example: videos/1080p_Sintel_Two_Stereos.mp4");
        }

        public string GetHttpInputFilePathWithMultipleMonoAudioTracks()
        {
            return GetOrThrowException("HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS",
                "The path to a file containing a video with multiple mono audio tracks. " +
                "Example: videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4");
        }

        public string GetS3InputBucketName()
        {
            return GetOrThrowException("S3_INPUT_BUCKET_NAME",
                "The name of your S3 input bucket. Example: my-bucket-name");
        }

        public string GetS3InputFilePath()
        {
            return GetOrThrowException("S3_INPUT_FILE_PATH",
                "The path to your S3 input file. Example: videos/1080p_Sintel.mp4");
        }

        public string GetS3InputArnRole()
        {
            return GetOrThrowException("S3_INPUT_ARN_ROLE",
                "The ARN role of your S3 role based input bucket.");
        }

        public string GetS3InputExternalId()
        {
            return GetOrThrowException("S3_INPUT_EXT_ID",
                "The external ID of your S3 role based input bucket.");
        }

        public string GetS3OutputBucketName()
        {
            return GetOrThrowException("S3_OUTPUT_BUCKET_NAME",
                "The name of your S3 output bucket. Example: my-bucket-name");
        }

        public string GetS3OutputAccessKey()
        {
            return GetOrThrowException("S3_OUTPUT_ACCESS_KEY",
                "The access key of your S3 output bucket.");
        }
        public string GetHttpInputBumperFilePath()
        {
            return GetOrThrowException("HTTP_INPUT_BUMPER_FILE_PATH",
                "The path to your Http bumper input file. Example: videos/bumper.mp4");
        }

        public string GetHttpInputPromoFilePath()
        {
            return GetOrThrowException("HTTP_INPUT_PROMO_FILE_PATH",
                "The path to your Http promo input file. Example: videos/promo.mp4");
        }

        public string GetS3OutputSecretKey()
        {
            return GetOrThrowException("S3_OUTPUT_SECRET_KEY",
                "The secret key of your S3 output bucket.");
        }

        public string GetS3OutputArnRole()
        {
            return GetOrThrowException("S3_OUTPUT_ARN_ROLE",
                "The ARN role of your S3 role based output bucket.");
        }

        public string GetS3OutputExternalId()
        {
            return GetOrThrowException("S3_OUTPUT_EXT_ID",
                "The external ID of your S3 role based output bucket.");
        }

        public string GetS3OutputBasePath()
        {
            var s3OutputBasePath = GetOrThrowException("S3_OUTPUT_BASE_PATH",
                "The base path on your S3 output bucket. Example: /outputs");

            if (s3OutputBasePath.StartsWith("/"))
            {
                s3OutputBasePath = s3OutputBasePath.Substring(1);
            }

            if (!s3OutputBasePath.EndsWith("/"))
            {
                s3OutputBasePath += "/";
            }

            return s3OutputBasePath;
        }

        public string GetWatermarkImagePath()
        {
            return GetOrThrowException("WATERMARK_IMAGE_PATH",
                "The path to the watermark image. Example: http://my-storage.biz/logo.png");
        }

        public string GetTextFilterText()
        {
            return GetOrThrowException("TEXT_FILTER_TEXT",
                "The text to be displayed by the text filter.");
        }

        public string GetDrmKey()
        {
            return GetOrThrowException("DRM_KEY",
                "16 byte encryption key, represented as 32 hexadecimal characters Example: cab5b529ae28d5cc5e3e7bc3fd4a544d");
        }

        public string GetDrmFairplayIv()
        {
            return GetOrThrowException("DRM_FAIRPLAY_IV",
                "16 byte initialization vector, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d");
        }

        public string GetDrmFairplayUri()
        {
            return GetOrThrowException("DRM_FAIRPLAY_URI",
                "URI of the licensing server Example: skd://userspecifc?custom=information");
        }

        public string GetDrmWidevineKid()
        {
            return GetOrThrowException("DRM_WIDEVINE_KID",
                "16 byte encryption key id, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d");
        }

        public string GetDrmWidevinePssh()
        {
            return GetOrThrowException("DRM_WIDEVINE_PSSH",
                "Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg==");
        }

        /* This generic method will enable addition and use of new config settings in a simple way */
        public string GetParameterByKey(string keyName)
        {
            return GetOrThrowException(keyName, "Configuration Parameter '" + keyName + "'");
        }

        private string GetOrThrowException(String key, String description)
        {
            foreach (var configurationName in _configuration.Keys)
            {
                var subConfiguration = (Dictionary<string, string>) _configuration[configurationName];

                if (!subConfiguration.ContainsKey(key))
                {
                    continue;
                }

                var value = subConfiguration[key];
                Console.WriteLine($"Retrieved '{key}' from '{configurationName}' config source: '{value}'");
                return value;
            }

            throw new ArgumentException(key, description);
        }

        private Dictionary<string, string> ParseEnvironmentVariables()
        {
            var environmentVariables = new Dictionary<string, string>();
            foreach (DictionaryEntry environmentVariable in Environment.GetEnvironmentVariables())
            {
                if (environmentVariable.Key == null || environmentVariable.Value == null)
                    continue;

                var key = (string) environmentVariable.Key;
                var value = (string) environmentVariable.Value;

                environmentVariables[key] = value;
            }

            return environmentVariables;
        }

        private Dictionary<string, string> ParsePropertiesFile(string filePath)
        {
            var fileProperties = new Dictionary<string, string>();

            try
            {
                foreach (var row in File.ReadAllLines(Path.Join(filePath, "examples.properties")))
                {
                    var rowSplitted = row.Split("=", 2);

                    // Don't add comment lines
                    if (row.Trim().StartsWith("#") || rowSplitted.Length != 2 || string.IsNullOrEmpty(rowSplitted[0]))
                    {
                        continue;
                    }

                    fileProperties.Add(rowSplitted[0], rowSplitted[1]);
                }
            }
            catch (FileNotFoundException)
            {
                // ignore exception if the file was not found
            }

            return fileProperties;
        }

        private Dictionary<string, string> ParseCliArguments(string[] args)
        {
            return args
                .Select(arg => arg.Split("=", 2))
                .Where(arg => arg.Length == 2 && !string.IsNullOrEmpty(arg[0]))
                .ToDictionary(item => item[0], value => value[1]);
        }
    }
}