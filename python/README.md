<p align="center">
  <a href="https://www.bitmovin.com">
      <img alt="Bitmovin Python API SDK Examples Header" src="https://cdn.bitmovin.com/frontend/encoding/openapi-clients/readme-headers/ReadmeHeader_PythonExamples.png" >
    </a>
  <h4 align="center">This folder contains examples demonstrating usage of the <a href="https://github.com/bitmovin/bitmovin-api-sdk-python" target="_blank">Bitmovin Python API SDK</a></h4>

  <p align="center">
    <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="license"></img></a>
  </p>
</p>

## 💡 Getting Started

You'll need an active Bitmovin API key for these examples to work.

> Don't have an account yet? [Sign up for a free Bitmovin trial plan](https://dashboard.bitmovin.com/signup)!

If you are new to the topic, we suggest reading our tutorial [Understanding the Bitmovin Encoding Object Model](https://bitmovin.com/docs/encoding/tutorials/understanding-the-bitmovin-encoding-object-model) to get a basic idea of the building blocks that make up an encoding.

For full documentation of all available API endpoints, see the [Bitmovin API reference](https://bitmovin.com/docs/encoding/api-reference).

### Prepare the configuration environment

Configuration parameters will be retrieved from these sources in the listed order:

1. Command line arguments passed when running the example (E.g.: `BITMOVIN_API_KEY=xyz`)
2. A properties file located in the root folder of the Python examples at `./examples.properties` (see `examples.properties.template` as reference)
3. Environment variables
4. A properties file located in the home folder at `~/.bitmovin/examples.properties` (see `examples.properties.template` as reference)

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

Execute run_example.sh with the name of the desired [example](src) as first parameter, followed by a list of configuration parameters if needed.

```bash
run-example.sh multi_codec_encoding --BITMOVIN_API_KEY=your-api-key --HTTP_INPUT_HOST=my-storage.biz
```

#### Windows

Execute run_example.bat with the name of the desired [example](src) as first parameter, followed by a list of configuration parameters if needed.

```bash
run-example.bat multi_codec_encoding --BITMOVIN_API_KEY=your-api-key --HTTP_INPUT_HOST=my-storage.biz
```

### More examples?
For more code snippets, and sometimes complete scripts, please have a look at our [tutorials](https://bitmovin.com/docs/encoding/tutorials) and our [Community pages](https://community.bitmovin.com/docs?tags=code-example%7Cbitmovin-encoding&utm_source=github&utm_medium=bitmovin-api-sdk-examples-python&utm_campaign=dev-community)
