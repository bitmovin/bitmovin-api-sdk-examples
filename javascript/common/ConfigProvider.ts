import {readFileSync} from 'fs';
import {resolve} from 'path';
import {EOL, homedir} from 'os';

/**
 * This class is responsible for retrieving config values from different sources in this order:
 *
 * <ol>
 *   <li>command line arguments (eg BITMOVIN_API_KEY=xyz)
 *   <li>properties file located in the root folder of the JavaScript examples at ./examples.properties
 *       (see examples.properties.template as reference)
 *   <li>environment variables
 *   <li>properties file located in the home folder at ~/.bitmovin/examples.properties (see
 *       examples.properties.template as reference)
 * </ol>
 */
export default class ConfigProvider {
  private configuration: Record<string, Record<string, string>> = {};

  constructor() {
    // parse command line arguments
    this.configuration['Command line arguments'] = ConfigProvider.parseCommandLineArguments();

    // parse properties from ./examples.properties
    this.configuration['Local properties file'] = ConfigProvider.parsePropertiesFile('.');

    // parse environment variables
    this.configuration['Environment variables'] = ConfigProvider.parseEnvironmentVariables();

    // parse properties from ~/.bitmovin/examples.properties
    this.configuration['System-wide properties file'] = ConfigProvider.parsePropertiesFile(
      resolve(homedir(), '.bitmovin')
    );
  }

  public getBitmovinApiKey(): string {
    return this.getOrThrowException('BITMOVIN_API_KEY', 'Your API key for the Bitmovin API.');
  }

  public getBitmovinTenantOrgId(): string {
    return this.getOrThrowException(
      'BITMOVIN_TENANT_ORG_ID',
      'The ID of the Organisation in which you want to perform the encoding.'
    );
  }

  public getHttpInputHost(): string {
    return this.getOrThrowException(
      'HTTP_INPUT_HOST',
      'Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz'
    );
  }

  public getHttpInputFilePath(): string {
    return this.getOrThrowException(
      'HTTP_INPUT_FILE_PATH',
      'The path to your Http input file. Example: videos/1080p_Sintel.mp4'
    );
  }

  public getHttpInputFilePathWithStereoSound() {
    return this.getOrThrowException(
      'HTTP_INPUT_FILE_PATH_STEREO_SOUND',
      'The path to a file containing a video with a single audio stereo stream. Example: videos/1080p_Sintel_Stereo.mp4'
    );
  }

  public getHttpInputFilePathWithSurroundSound(): string {
    return this.getOrThrowException(
      'HTTP_INPUT_FILE_PATH_SURROUND_SOUND',
      'The path and filename for a file containing a video with a 5.1 audio stream. Example: videos/1080p_Sintel_Surround.mp4'
    );
  }

  public getHttpInputFilePathWithMultipleMonoAudioTracks() {
    return this.getOrThrowException(
      'HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS',
      'The path to a file containing a video with multiple mono audio tracks. Example: videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4'
    );
  }

  public getHttpInputFilePathWithTwoStereoTracks() {
    return this.getOrThrowException(
      'HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS',
      'The path to a file containing a video with 2 stereo tracks. Example: videos/1080p_Sintel_Two_Stereos.mp4'
    );
  }

  public getHttpInputBumperFilePath() {
    return this.getOrThrowException(
      'HTTP_INPUT_BUMPER_FILE_PATH',
      'The path to your Http input file. Example: videos/bumper.mp4'
    );
  }

  public getHttpInputPromoFilePath() {
    return this.getOrThrowException(
      'HTTP_INPUT_PROMO_FILE_PATH',
      'The path to your Http input file. Example: videos/promo.mp4'
    );
  }

  public getS3OutputBucketName(): string {
    return this.getOrThrowException(
      'S3_OUTPUT_BUCKET_NAME',
      'The name of your S3 output bucket. Example: my-bucket-name'
    );
  }

  public getS3OutputAccessKey(): string {
    return this.getOrThrowException('S3_OUTPUT_ACCESS_KEY', 'The access key of your S3 output bucket.');
  }

  public getS3OutputSecretKey(): string {
    return this.getOrThrowException('S3_OUTPUT_SECRET_KEY', 'The secret key of your S3 output bucket.');
  }

  public getS3OutputBasePath(): string {
    return ConfigProvider.prepareS3OutputBasePath(
      this.getOrThrowException('S3_OUTPUT_BASE_PATH', 'The base path on your S3 output bucket. Example: /outputs')
    );
  }

  public getWatermarkImagePath(): string {
    return this.getOrThrowException(
      'WATERMARK_IMAGE_PATH',
      'The path to the watermark image. Example: http://my-storage.biz/logo.png'
    );
  }

  public getTextFilterText(): string {
    return this.getOrThrowException('TEXT_FILTER_TEXT', 'The text to be displayed by the text filter.');
  }

  public getDrmKey(): string {
    return this.getOrThrowException(
      'DRM_KEY',
      '16 byte encryption key, represented as 32 hexadecimal characters Example: cab5b529ae28d5cc5e3e7bc3fd4a544d'
    );
  }

  public getDrmFairplayIv(): string {
    return this.getOrThrowException(
      'DRM_FAIRPLAY_IV',
      '16 byte initialization vector, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d'
    );
  }

  public getDrmFairplayUri(): string {
    return this.getOrThrowException(
      'DRM_FAIRPLAY_URI',
      'URI of the licensing server Example: skd://userspecifc?custom=information'
    );
  }

  public getDrmWidevineKid(): string {
    return this.getOrThrowException(
      'DRM_WIDEVINE_KID',
      '16 byte encryption key id, represented as 32 hexadecimal characters Example: 08eecef4b026deec395234d94218273d'
    );
  }

  public getDrmWidevinePssh(): string {
    return this.getOrThrowException(
      'DRM_WIDEVINE_PSSH',
      'Base64 encoded PSSH payload Example: QWRvYmVhc2Rmc2FkZmFzZg=='
    );
  }

  public getParameterByKey(key: string): string {
    return this.getOrThrowException(key, `Configuration Parameter '${key}'`);
  }

  private getOrThrowException(key: string, description: string): any {
    for (const configurationName of Object.keys(this.configuration)) {
      const subConfiguration = this.configuration[configurationName];
      if (key in subConfiguration) {
        const value = subConfiguration[key];
        console.log(`Retrieved '${key}' from '${configurationName}' config source: '${value}'`);
        return value;
      }
    }

    // '\x1b[' CSI (Control Sequence Introducer)
    // '31' Color Code
    // 'm' Finishing Symbol
    // Source: http://jafrog.com/2013/11/23/colors-in-terminal.html
    console.error('\x1b[31m', `[MissingArgument] '${key}' - '${description}' could not be found in the config source.`);
    process.exit(-1);
  }

  private static prepareS3OutputBasePath(outputBasePath: string) {
    if (outputBasePath.startsWith('/')) {
      outputBasePath = outputBasePath.slice(1);
    }
    if (!outputBasePath.endsWith('/')) {
      outputBasePath += '/';
    }
    return outputBasePath;
  }

  private static parseCommandLineArguments(): {[key: string]: string} {
    return ConfigProvider.parseKeyValueList(process.argv);
  }

  private static parsePropertiesFile(propertiesFileDirectory: string): any {
    const propertiesFile = resolve(propertiesFileDirectory, 'examples.properties');

    try {
      const properties = readFileSync(propertiesFile, 'utf8');

      return ConfigProvider.parseKeyValueList(properties.split(EOL));
    } catch (e) {
      if (e.code === 'ENOENT') {
        return [];
      } else {
        throw e;
      }
    }
  }

  private static parseEnvironmentVariables(): any {
    return process.env;
  }

  private static parseKeyValueList(keyValues: string[]): {[key: string]: string} {
    return keyValues
      .map((x) => x.trim().split('='))
      .map((parts) => ({key: parts[0], value: parts.slice(1).join('=')}))
      .filter(({value}) => value)
      .reduce((result, {key, value}) => Object.assign(result, {[key]: value}), {});
  }
}
