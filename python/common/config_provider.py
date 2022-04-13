import optparse
import configparser

from os import environ, path
from pathlib import Path
from sys import argv
from common.bitmovin_argument import BitmovinArgument


class ConfigProvider(object):
    _properties = {
        "BITMOVIN_API_KEY":
            BitmovinArgument("Your API key for the Bitmovin API.", True),
        "BITMOVIN_TENANT_ORG_ID":
            BitmovinArgument("The ID of the Organisation in which you want to perform the encoding.", True),
        "HTTP_INPUT_HOST":
            BitmovinArgument(
                "Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz"),
        "HTTP_INPUT_FILE_PATH":
            BitmovinArgument("The path to your Http input file. Example: videos/1080p_Sintel.mp4"),
        "HTTP_INPUT_FILE_PATH_STEREO_SOUND":
            BitmovinArgument("The path to a file containing a video with a single audio stereo stream. "
                             "Example: videos/1080p_Sintel_Stereo.mp4"),
        "HTTP_INPUT_FILE_PATH_SURROUND_SOUND":
            BitmovinArgument("The path and filename for a file containing a video with a 5.1 audio stream. "
                             "Example: videos/1080p_Sintel_Surround.mp4"),
        "HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS":
            BitmovinArgument(
                "The path to a file containing a video with multiple mono audio tracks. "
                "Example: videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4"),
        "HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS":
            BitmovinArgument("The path to a file containing a video with 2 stereo tracks. "
                             "Example: videos/1080p_Sintel_Two_Stereos.mp4"),
        "HTTP_INPUT_BUMPER_FILE_PATH":
            BitmovinArgument(
                "The path to your input file on the provided HTTP server to be concatenated before "
                "`HTTP_INPUT_FILE_PATH`. Example: videos/bumper.mp4"),
        "HTTP_INPUT_PROMO_FILE_PATH":
            BitmovinArgument("The path to your input file on the provided HTTP server to be concatenated after "
                             "HTTP_INPUT_FILE_PATH. Example: videos/promo.mp4"),
        "S3_OUTPUT_BUCKET_NAME":
            BitmovinArgument("The name of your S3 output bucket. Example: my-bucket-name"),
        "S3_OUTPUT_ACCESS_KEY":
            BitmovinArgument("The access key of your S3 output bucket."),
        "S3_OUTPUT_SECRET_KEY":
            BitmovinArgument("The secret key of your S3 output bucket."),
        "S3_OUTPUT_BASE_PATH":
            BitmovinArgument("The base path on your S3 output bucket. Example: /outputs"),
        "WATERMARK_IMAGE_PATH":
            BitmovinArgument("The path to the watermark image. Example: http://my-storage.biz/logo.png"),
        "TEXT_FILTER_TEXT":
            BitmovinArgument("The text to be displayed by the text filter."),
        "DRM_KEY":
            BitmovinArgument("16 byte encryption key, represented as 32 hexadecimal characters Example: "
                             "cab5b529ae28d5cc5e3e7bc3fd4a544d"),
        "DRM_FAIRPLAY_IV":
            BitmovinArgument("16 byte initialization vector, represented as 32 hexadecimal characters Example: "
                             "08eecef4b026deec395234d94218273d"),
        "DRM_FAIRPLAY_URI":
            BitmovinArgument("URI of the licensing server Example: skd://userspecifc?custom=information"),
        "DRM_WIDEVINE_KID":
            BitmovinArgument("16 byte encryption key id, represented as 32 hexadecimal characters Example: "
                             "08eecef4b026deec395234d94218273d"),
        "DRM_WIDEVINE_PSSH":
            BitmovinArgument("Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg==")
    }

    def __init__(self):
        self.configuration = {
            "Command line arguments": self._parse_cli_arguments(),
            "Local properties file": self._parse_properties_file("."),
            "Environment variables": environ.copy(),
            "System-wide properties file": self._parse_properties_file(path.join(str(Path.home()), ".bitmovin"))
        }

    def get_bitmovin_api_key(self):
        return self._get_or_throw_exception("BITMOVIN_API_KEY")

    def get_bitmovin_tenant_org_id(self):
        return self._get_or_throw_exception("BITMOVIN_TENANT_ORG_ID")

    def get_http_input_host(self):
        return self._get_or_throw_exception("HTTP_INPUT_HOST")

    def get_http_input_file_path(self):
        return self._get_or_throw_exception("HTTP_INPUT_FILE_PATH")

    def get_http_input_file_path_with_stereo_sound(self):
        return self._get_or_throw_exception("HTTP_INPUT_FILE_PATH_STEREO_SOUND")

    def get_http_input_file_path_with_surround_sound(self):
        return self._get_or_throw_exception("HTTP_INPUT_FILE_PATH_SURROUND_SOUND")

    def get_http_input_file_path_with_multiple_mono_audio_tracks(self):
        return self._get_or_throw_exception("HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS")

    def get_http_input_file_path_with_two_stereo_tracks(self):
        return self._get_or_throw_exception("HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS")

    def get_http_input_bumper_file_path(self):
        return self._get_or_throw_exception("HTTP_INPUT_BUMPER_FILE_PATH")

    def get_http_input_promo_file_path(self):
        return self._get_or_throw_exception("HTTP_INPUT_PROMO_FILE_PATH")

    def get_http_audio_file_path(self):
        return self._get_or_throw_exception("HTTP_INPUT_AUDIO_FILE_PATH")

    def get_http_dolby_vision_metadata_file_path(self):
        return self._get_or_throw_exception("HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH")

    def get_hdr_conversion_input_format(self):
        return self._get_or_throw_exception("HDR_CONVERSION_INPUT_FORMAT")

    def get_hdr_conversion_output_format(self):
        return self._get_or_throw_exception("HDR_CONVERSION_OUTPUT_FORMAT")

    def get_s3_output_bucket_name(self):
        return self._get_or_throw_exception("S3_OUTPUT_BUCKET_NAME")

    def get_s3_output_access_key(self):
        return self._get_or_throw_exception("S3_OUTPUT_ACCESS_KEY")

    def get_s3_output_secret_key(self):
        return self._get_or_throw_exception("S3_OUTPUT_SECRET_KEY")

    def get_s3_output_base_path(self):
        s3_output_base_path = self._get_or_throw_exception("S3_OUTPUT_BASE_PATH")

        if s3_output_base_path.startswith("/"):
            s3_output_base_path = s3_output_base_path[1:]

        if not s3_output_base_path.endswith("/"):
            s3_output_base_path += "/"

        return s3_output_base_path

    def get_watermark_image_path(self):
        return self._get_or_throw_exception("WATERMARK_IMAGE_PATH")

    def get_text_filter(self):
        return self._get_or_throw_exception("TEXT_FILTER_TEXT")

    def get_drm_key(self):
        return self._get_or_throw_exception("DRM_KEY")

    def get_drm_fairplay_iv(self):
        return self._get_or_throw_exception("DRM_FAIRPLAY_IV")

    def get_drm_fairplay_uri(self):
        return self._get_or_throw_exception("DRM_FAIRPLAY_URI")

    def get_drm_widevine_kid(self):
        return self._get_or_throw_exception("DRM_WIDEVINE_KID")

    def get_drm_widevine_pssh(self):
        return self._get_or_throw_exception("DRM_WIDEVINE_PSSH")

    def get_parameter_by_key(self, key_name):
        return self._get_or_throw_exception(key_name)

    def _parse_cli_arguments(self):
        # type: () -> dict

        if len(argv) is 1:
            return {}

        parser = optparse.OptionParser()

        for name in self._properties:
            parser.add_option(
                "--{}".format(name),
                dest=name,
                help=self._properties[name].description
            )

        options, args = parser.parse_args()

        return self._get_dict_with_set_values(vars(options))

    @staticmethod
    def _parse_properties_file(properties_file_directory):
        # type: (str) -> dict

        properties_file_path = path.join(properties_file_directory, "examples.properties")

        try:
            section_name = "section"

            # Add a section so ConfigParser can read it
            with open(properties_file_path, 'r') as f:
                config_string = "[{}]\n{}".format(section_name, f.read())

            config_parser = configparser.ConfigParser()
            config_parser.optionxform = str
            config_parser.read_string(config_string)

            return ConfigProvider._get_dict_with_set_values(dict(config_parser.items(section_name)))
        except FileNotFoundError:
            return {}
        except Exception as ex:
            raise RuntimeError("Error reading properties file: {}".format(properties_file_path), ex)

    @staticmethod
    def _get_dict_with_set_values(dictionary):
        return {k: v for k, v in dictionary.items() if v}

    def _get_or_throw_exception(self, key):
        # type: (str) -> str

        for configuration_key in self.configuration:
            sub_config = self.configuration[configuration_key]

            if key in sub_config:
                value = sub_config[key]
                print("Retrieved '{}' from '{}' config source: '{}'".format(key, configuration_key, value))
                return value

        if key in self._properties:
            raise MissingArgumentError(key, self._properties[key].description)
        else:
            raise MissingArgumentError(key, "Configuration Parameter '{}'".format(key))


class MissingArgumentError(RuntimeError):
    def __init__(self, argument, description):
        super(MissingArgumentError, self).__init__(argument, description)
