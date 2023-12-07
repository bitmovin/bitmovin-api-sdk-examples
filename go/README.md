<p align="center">
  <a href="https://www.bitmovin.com">
    <img alt="Bitmovin GO API SDK Examples Header" src="https://cdn.bitmovin.com/frontend/encoding/openapi-clients/readme-headers/ReadmeHeader_GoExamples.png" >
  </a>

  <h4 align="center">This folder contains examples demonstrating usage of the <a href="https://github.com/bitmovin/bitmovin-api-sdk-go" target="_blank">Bitmovin GO API SDK</a></h4>

  <p align="center">
    <a href="https://search.maven.org/artifact/com.bitmovin.api.sdk/bitmovin-api-sdk"><img src="https://img.shields.io/maven-central/v/com.bitmovin.api.sdk/bitmovin-api-sdk.svg" alt="Maven"></img></a>
    <a href="https://www.javadoc.io/doc/com.bitmovin.api.sdk/bitmovin-api-sdk"><img src="https://www.javadoc.io/badge/com.bitmovin.api.sdk/bitmovin-api-sdk.svg" alt="Javadoc"></img></a>    
    <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="license"></img></a>
  </p>
</p>

## 💡 Getting Started

You'll need an active Bitmovin API key for these examples to work.

> Don't have an account yet? [Sign up for a free Bitmovin trial plan](https://dashboard.bitmovin.com/signup)!

If you are new to the topic, we suggest reading our tutorial [Understanding the Bitmovin Encoding Object Model](https://bitmovin.com/docs/encoding/tutorials/understanding-the-bitmovin-encoding-object-model) to get a basic idea of the building blocks that make up an encoding.

For full documentation of all available API endpoints, see the [Bitmovin API reference](https://bitmovin.com/docs/encoding/api-reference).

### Prepare the configuration environment

Configuration parameters will be retrieved from a `examples.properties` file located at the root of the GO examples. You can have a look at `examples.properties.template` file for a reference.

Here is an example of an `examples.properties` file:
```bash
BITMOVIN_API_KEY=my-secret-d9fa-4f3b-b7a4-92c67a6d5056
HTTP_INPUT_HOST=my-storage.biz
HTTP_INPUT_FILE_PATH=/path/to/my/input/file.mkv
S3_OUTPUT_BUCKET_NAME=my-s3-bucket-name
S3_OUTPUT_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_OUTPUT_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_OUTPUT_BASE_PATH=/output/finest/encodings
```

### How can I run an example?

#### Linux
Execute run_example.sh with the name of the desired [example](cmd) as first parameter.
```bash
run-example.sh cenc_drm_content_protection
```

#### Windows

Execute run_example.bat with the name of the desired [example](cmd) as first parameter.
```bash
run-example.bat cenc_drm_content_protection
```

### More examples?
For more code snippets, and sometimes complete scripts, please have a look at our [tutorials](https://bitmovin.com/docs/encoding/tutorials) and our [Community pages](https://community.bitmovin.com/docs?tags=code-example%7Cbitmovin-encoding&utm_source=github&utm_medium=bitmovin-api-sdk-examples-go&utm_campaign=dev-community)
