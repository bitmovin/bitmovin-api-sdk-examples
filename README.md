<p align="center">
  <a href="https://www.bitmovin.com">
    <img alt="Bitmovin API SDK Examples Header" src="https://cdn.bitmovin.com/frontend/encoding/openapi-clients/readme-headers/Readme_OpenApi_Header.png" >
  </a>

  <h4 align="center">This repository provides examples demonstrating usage of the <br><a href="https://bitmovin.com/docs/encoding/sdks" target="_blank">Bitmovin API SDKs</a> in different programming languages.</h4>

  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"></img></a>
  </p>
</p>

### 💡 Getting started

You'll need an active Bitmovin API key for these examples to work.

> Don't have an account yet? [Sign up for a free Bitmovin trial plan](https://dashboard.bitmovin.com/signup)!

If you are new to the topic, we suggest reading our tutorial [Understanding the Bitmovin Encoding Object Model](https://bitmovin.com/docs/encoding/tutorials/understanding-the-bitmovin-encoding-object-model) to get a basic idea of the building blocks that make up an encoding.

For instructions how to set up the configuration environment and run examples, consult the `README.md` file in the subfolder for your preferred programming language.

For full documentation of all available API endpoints, see the [Bitmovin API reference](https://bitmovin.com/docs/encoding/api-reference).

### Overview
+ [Fixed Bitrate Ladder Encoding](#fixed-bitrate-ladder-encoding)  
   Generate multiple MP4 renditions from a single input file using a fixed set of resolutions and target bitrates
+ [Generating Default Manifests](#generating-default-manifests)  
   Generate basic DASH and HLS manifests tailored to your encoding output
+ [Per-Title Encoding](#per-title-encoding)  
   Generate optimized renditions by letting the Per-Title algorithm choose resolutions and bitrates based on the complexity of your content
+ [Multi Codec Encoding](#multi-codec-encoding)  
   Run a multi-codec workflow following the best practices.
+ [Multi-language Broadcast TS Encoding](#multi-language-broadcast-ts-encoding)  
   Add multiple audio streams to a Broadcast TS muxing
+ [Applying Filters](#applying-filters)  
   Enhance and manipulate content by applying pre-defined video or audio filters
+ [Applying CENC DRM Content Protection](#applying-cenc-drm-content-protection)  
   Encrypt output to prevent unauthorized playback
+ [Server-Side Ad Insertion (SSAI)](#server-side-ad-insertion-ssai)  
   Prevent blocking of ads by delivering a continuous content stream
+ [RTMP Live Encoding](#rtmp-live-encoding)  
   Start a live encoding using an RTMP stream as input
+ [Batch Encoding](#batch-encoding)  
   Efficiently start and track a large number of encodings
+ [Multiple Inputs Concatenation](#multiple-inputs-concatenation)  
   Combine multiple input files into a single output using concatenation and trimming
+  [HDR SDR Conversion](#hdr-sdr-conversion)  
  Convert dynamic range format between DolbyVision, HDR10, HLG and SDR.
+ **Audio Manipulations**
  
  Map, mix and merge audio streams and channels from one or multiple sources
   + [Simple Handling - Implicit Mapping](#simple-handling---implicit-mapping)  
   + [Simple Handling - Distinct Input Files](#simple-handling---distinct-input-files)
   + [Channel Mixing - Swapping Channels](#channel-mixing---swapping-channels)
   + [Channel Mixing - Downmixing](#channel-mixing---downmixing)
   + [Stream Mapping - Mono Input Tracks](#stream-mapping---mono-input-tracks)
   + [Stream Merging - Multiple Streams](#stream-merging---background-audio)


---
### Fixed Bitrate Ladder Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/FixedBitrateLadder.cs">C#</a> -
<a href="java/src/main/java/FixedBitrateLadder.java">Java</a> -
<a href="javascript/src/FixedBitrateLadder.ts">TS/JS</a> -
<a href="php/src/FixedBitrateLadder.php">PHP</a> -
<a href="python/src/fixed_bitrate_ladder.py">Python</a>

This example demonstrates how to create multiple MP4 renditions in a single encoding, using a fixed resolution- and bitrate ladder.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Generating Default Manifests

<a href="dotnet/Bitmovin.Api.Sdk.Examples/DefaultManifest.cs">C#</a> -
<a href="java/src/main/java/DefaultManifests.java">Java</a> -
<a href="javascript/src/DefaultManifest.ts">TS/JS</a> -
<a href="php/src/DefaultManifest.php">PHP</a> -
<a href="python/src/default_manifest.py">Python</a>   

This example demonstrates how to create basic DASH and HLS manifests for an encoding. Default manifests will try include all the encoding's features that are supported by the respective manifest type.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Per-Title Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/PerTitleEncoding.cs">C#</a> -
<a href="java/src/main/java/PerTitleEncoding.java">Java</a> -
<a href="javascript/src/PerTitleEncoding.ts">TS/JS</a> -
<a href="php/src/PerTitleEncoding.php">PHP</a> -
<a href="python/src/per_title_encoding.py">Python</a>

This example shows how to do a Per-Title encoding with default manifests. 
A Per-Title encoding automatically detects the optimal codec settings for your video assets.

Visit https://bitmovin.com/per-title-encoding/ to get an insight what Per-Title encoding is and how it works.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Multi Codec Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/MultiCodecEncoding.cs">C#</a> -
<a href="java/src/main/java/MultiCodecEncoding.java">Java</a> -
<a href="javascript/src/MultiCodecEncoding.ts">TS/JS</a> -
<a href="php/src/MultiCodecEncoding.php">PHP</a> -
<a href="python/src/multi_codec_encoding.py">Python</a>

This example showcases how to run a multi-codec workflow following the best practices.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Multi-language Broadcast TS Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/MultiLanguageBroadcastTs.cs">C#</a> -
<a href="java/src/main/java/MultiLanguageBroadcastTs.java">Java</a> -
<a href="javascript/src/MultiLanguageBroadcastTs.ts">TS/JS</a> -
 <a href="php/src/MultiLanguageBroadcastTs.php">PHP</a> -
<a href="python/src/multi_language_broadcast_ts.py">Python</a>

This example demonstrates how multiple audio streams can be included in a BroadcastTS muxing. BroadcastTS muxings are [MPEG transport stream](https://en.wikipedia.org/wiki/MPEG_transport_stream) muxings which allow setting custom properties such as [PCR](https://en.wikipedia.org/wiki/MPEG_transport_stream#PCR) interval and [PID](https://en.wikipedia.org/wiki/MPEG_transport_stream#Packet_identifier_(PID))s for transmission to traditional broadcast targets like set top boxes, QAM streamers and similar devices. This muxing is not generally used for streaming to IP devices such as browsers, iOS, or Android devices.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Applying Filters

<a href="dotnet/Bitmovin.Api.Sdk.Examples/Filters.cs">C#</a> -
<a href="java/src/main/java/Filters.java">Java</a> -
<a href="javascript/src/Filters.ts">TS/JS</a> -
<a href="php/src/Filters.php">PHP</a> -
<a href="python/src/filters.py">Python</a>

This example demonstrates how to apply filters to a video stream. Filters will manipulate the content of a stream, e.g. remove noise or add a watermark image. See the [Encoding Filters API Reference](https://bitmovin.com/docs/encoding/api-reference/sections/filters) for a complete list of available filters.
 
 Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))
 + `WATERMARK_IMAGE_PATH` ([?](#WATERMARK_IMAGE_PATH))
 + `TEXT_FILTER_TEXT` ([?](#TEXT_FILTER_TEXT))

---
### Applying CENC DRM Content Protection

<a href="dotnet/Bitmovin.Api.Sdk.Examples/CencDrmContentProtection.cs">C#</a> -
<a href="java/src/main/java/CencDrmContentProtection.java">Java</a> -
<a href="javascript/src/CencDrmContentProtection.ts">TS/JS</a> -
<a href="php/src/CencDrmContentProtection.php">PHP</a> -
<a href="python/src/cenc_drm_content_protection.py">Python</a>

This example shows how DRM content protection can be applied to a fragmented MP4 muxing. DRM is used to prevent playback on unauthorized devices (piracy) and requires integration with a key server.  
The encryption is configured to be compatible with both FairPlay and Widevine, using the [MPEG Common Encryption](https://en.wikipedia.org/wiki/MPEG_Common_Encryption) standard.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))
+ `DRM_KEY` ([?](#DRM_KEY))
+ `DRM_FAIRPLAY_IV` ([?](#DRM_FAIRPLAY_IV))
+ `DRM_FAIRPLAY_URI` ([?](#DRM_FAIRPLAY_URI))
+ `DRM_WIDEVINE_KID` ([?](#DRM_WIDEVINE_KID))
+ `DRM_WIDEVINE_PSSH` ([?](#DRM_WIDEVINE_PSSH))

---
### Server-Side Ad Insertion (SSAI)

<a href="dotnet/Bitmovin.Api.Sdk.Examples/ServerSideAdInsertion.cs">C#</a> -
<a href="java/src/main/java/ServerSideAdInsertion.java">Java</a> -
<a href="javascript/src/ServerSideAdInsertion.ts">TS/JS</a> -
<a href="php/src/ServerSideAdInsertion.php">PHP</a> -
<a href="python/src/server_side_ad_insertion.py">Python</a>

This example demonstrates how to create multiple fMP4 renditions with Server Side Ad Insertion (SSAI).

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### RTMP Live Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/RtmpLiveEncoding.cs">C#</a> -
<a href="java/src/main/java/RtmpLiveEncoding.java">Java</a> -
<a href="javascript/src/RtmpLiveEncoding.ts">TS/JS</a> -
<a href="php/src/RtmpLiveEncoding.php">PHP</a> -
<a href="python/src/rtmp_live_encoding.py">Python</a>

This example shows how to configure and start a live encoding using default DASH and HLS manifests. 
For more information see: https://bitmovin.com/live-encoding-live-streaming

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Batch Encoding

<a href="dotnet/Bitmovin.Api.Sdk.Examples/BatchEncoding.cs">C#</a> -
<a href="java/src/main/java/BatchEncoding.java">Java</a> -
<a href="javascript/src/BatchEncoding.ts">TS/JS</a> -
<a href="php/src/BatchEncoding.php">PHP</a> -
<a href="python/src/batch_encoding.py">Python</a>

This example demonstrates how to efficiently execute a large batch of encodings in parallel. In 
order to keep the startup time for each encoding to a minimum, it is advisable to constantly have
some encodings queued. Encodings will therefore be started in a way to maintain a constant queue
size.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### Multiple Inputs Concatenation

<a href="dotnet/Bitmovin.Api.Sdk.Examples/ConcatenationMultipleInputs.cs">C#</a> -
<a href="java/src/main/java/ConcatenationMultipleInputs.java">Java</a> -
<a href="javascript/src/ConcatenationMultipleInputs.ts">TS/JS</a> -
<a href="php/src/ConcatenationMultipleInputs.php">PHP</a> -
<a href="python/src/concatenation_multiple_inputs.py">Python</a>

This example demonstrates how to use concatenation and trimming to combine multiple input files into a single output.
This script is the full version of the script documented in the tutorial on concatenation and trimming https://bitmovin.com/docs/encoding/tutorials/stitching-and-trimming-part-1-the-basics

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `HTTP_INPUT_BUMPER_FILE_PATH` ([?](#HTTP_INPUT_BUMPER_FILE_PATH))
+ `HTTP_INPUT_PROMO_FILE_PATH` ([?](#HTTP_INPUT_PROMO_FILE_PATH))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

---
### HDR SDR Conversion
<a href="python/src/hdr_conversions.py">Python</a>

This example demonstrates how to convert dynamic range format between DolbyVision, HDR10, HLG and SDR.

The supported HDR/SDR conversions are as follows. If the target output format is either DolbyVision, HDR10 or HLG, this example adds SDR renditions automatically. This example works only with Bitmovin Encoder version 2.98.0 or later.

- Input: DolbyVision
    - Output:
        - DolbyVision and SDR
        - HDR10 and SDR
- Input: HDR10
    - Output:
        - HDR10 and SDR
        - HLG and SDR
- Input: HLG
    - Output:
        - HLG and SDR
        - HDR10 and SDR
- Input: SDR
    - Output:
        - HDR10 and SDR
        - HLG and SDR

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `HTTP_INPUT_AUDIO_FILE_PATH` ([?](#HTTP_INPUT_AUDIO_FILE_PATH))
+ `HDR_CONVERSION_INPUT_FORMAT` ([?](#HDR_CONVERSION_INPUT_FORMAT))
+ `HDR_CONVERSION_OUTPUT_FORMAT` ([?](#HDR_CONVERSION_OUTPUT_FORMAT))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

If you want to load a DolbyVision metadata as a sidecar XML file, the following parameter also needs to be specified. If that parameter is not provided for a DolbyVision encoding, the example assumes the corresponding metadata is embedded into the DolbyVision input mezzanine file itself.
+ `HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH` ([?](#HTTP_INPUT_DOLBY_VISION_METADATA_FILE_PATH))

---
### Audio Manipulations
A set of examples that demonstrate how to perform audio stream and channel manipulations.
They are provided as illustrations of the [tutorial on audio manipulations]
(https://bitmovin.com/docs/encoding/tutorials/separating-and-combining-audio-streams)

#### Simple Handling - Implicit Mapping

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/SimpleHandlingImplicitMapping.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/SimpleHandling_ImplicitMapping.java">Java</a> -
<a href="javascript/src/AudioManipulations/SimpleHandlingImplicitMapping.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/SimpleHandling_ImplicitMapping.php">PHP</a> -
<a href="python/src/audio_manipulations/simple_handling_implicit_mapping.py">Python</a>

This example demonstrates the simplest mechanism to include a stereo audio stream in an output
MP4, from an input file containing a stereo audio stream (and a video stream), with the use of a 
single IngestInputStream.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH_STEREO_SOUND` ([?](#HTTP_INPUT_FILE_PATH_STEREO_SOUND))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

#### Simple Handling - Distinct Input Files

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/SimpleHandlingDistinctInputFiles.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/SimpleHandling_DistinctInputFiles.java">Java</a> -
<a href="javascript/src/AudioManipulations/SimpleHandlingDistinctInputFiles.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/SimpleHandling_DistinctInputFiles.php">PHP</a> -
<a href="python/src/audio_manipulations/simple_handling_distinct_input_files.py">Python</a>

This example demonstrates how to combine and map audio streams from multiple input files into a
single output MP4 file with multiple audio streams/tracks, with multiple IngestInputStreams.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH` ([?](#HTTP_INPUT_FILE_PATH))
+ `HTTP_INPUT_FILE_PATH_STEREO_SOUND` ([?](#HTTP_INPUT_FILE_PATH_STEREO_SOUND))
+ `HTTP_INPUT_FILE_PATH_SURROUND_SOUND` ([?](#HTTP_INPUT_FILE_PATH_SURROUND_SOUND))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

#### Channel Mixing - Swapping Channels

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/ChannelMixingSwappingChannels.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/ChannelMixing_SwappingChannels.java">Java</a> -
<a href="javascript/src/AudioManipulations/ChannelMixingSwappingChannels.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/ChannelMixing_SwappingChannels.php">PHP</a> -
<a href="python/src/audio_manipulations/channel_mixing_swapping_channels.py">Python</a>

This example demonstrates how to swap 2 audio channels from a stereo input, using a simple 
AudioMixInputStream configuration.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH_STEREO_SOUND` ([?](#HTTP_INPUT_FILE_PATH_STEREO_SOUND))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

#### Channel Mixing - Downmixing

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/ChannelMixingDownmixing.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/ChannelMixing_Downmixing.java">Java</a> -
<a href="javascript/src/AudioManipulations/ChannelMixingDownmixing.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/ChannelMixing_Downmixing.php">PHP</a> -
<a href="python/src/audio_manipulations/channel_mixing_downmixing.py">Python</a>

This example demonstrates one mechanism to downmix a 5.1 stream down to 2.0.
It uses an advanced AudioMixInputStream configuration with gain adjusted on each input channel.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH_SURROUND_SOUND` ([?](#HTTP_INPUT_FILE_PATH_SURROUND_SOUND))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

#### Stream Mapping - Mono Input Tracks

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/StreamMappingMonoInputTracks.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/StreamMapping_MonoInputTracks.java">Java</a> -
<a href="javascript/src/AudioManipulations/StreamMappingMonoInputTracks.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/StreamMapping_MonoInputTracks.php">PHP</a> -
<a href="python/src/audio_manipulations/stream_mapping_mono_input_tracks.py">Python</a>

This example demonstrates one mechanism to create single output tracks from multiple mono input
tracks, using multiple IngestInputStreams (by position in the source),
and mapping them to output channels (by type).

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS` ([?](#HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

#### Stream Merging - Background Audio

<a href="dotnet/Bitmovin.Api.Sdk.Examples/AudioManipulations/StreamMergingBackgroundAudio.cs">C#</a> -
<a href="java/src/main/java/AudioManipulations/StreamMerging_BackgroundAudio.java">Java</a> -
<a href="javascript/src/AudioManipulations/StreamMergingBackgroundAudio.ts">TS/JS</a> -
<a href="php/src/AudioManipulations/StreamMerging_BackgroundAudio.php">PHP</a> -
<a href="python/src/audio_manipulations/stream_merging_background_audio.py">Python</a>

This example demonstrates how to merge multiple stereo streams (from a single file, but this can
easily be extended to select them from separate input files), adjusting gain on the second stream
to turn it into a background effect.

Required configuration parameters:
+ `BITMOVIN_API_KEY` ([?](#BITMOVIN_API_KEY))
+ `BITMOVIN_TENANT_ORG_ID` ([?](#BITMOVIN_TENANT_ORG_ID))
+ `HTTP_INPUT_HOST` ([?](#HTTP_INPUT_HOST))
+ `HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS` ([?](#HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS))
+ `S3_OUTPUT_BUCKET_NAME` ([?](#S3_OUTPUT_BUCKET_NAME))
+ `S3_OUTPUT_ACCESS_KEY` ([?](#S3_OUTPUT_ACCESS_KEY))
+ `S3_OUTPUT_SECRET_KEY` ([?](#S3_OUTPUT_SECRET_KEY))
+ `S3_OUTPUT_BASE_PATH` ([?](#S3_OUTPUT_BASE_PATH))

## Configuration Parameters

These are the parameters that need to be supplied for the examples to work. 
They can be defined in a file, set as environment variables or passed directly to the `run-example` script.

**Note!** See the `README.md` of the API SDK examples in your preferred programming language on how to configure parameters.

<a name="BITMOVIN_API_KEY">**`BITMOVIN_API_KEY`**</a> - Your API key for the Bitmovin API

<a name="BITMOVIN_TENANT_ORG_ID">**`BITMOVIN_TENANT_ORG_ID`**</a> - The ID of the Organisation in which you want to perform the encoding. Only required if working with a multi-tenant account.

<a name="HTTP_INPUT_HOST">**`HTTP_INPUT_HOST`**</a> - The Hostname or IP address of the HTTP server hosting your input files  
Example: `my-storage.biz`

<a name="HTTP_INPUT_FILE_PATH">**`HTTP_INPUT_FILE_PATH`**</a> - The path to your input file on the HTTP host  
Example: `videos/1080p_Sintel.mp4`

<a name="HTTP_INPUT_BUMPER_FILE_PATH">**`HTTP_INPUT_BUMPER_FILE_PATH`**</a> - The path to your input file on the provided HTTP server to be concatenated before HTTP_INPUT_FILE_PATH  
Example: `videos/bumper.mp4`

<a name="HTTP_INPUT_PROMO_FILE_PATH">**`HTTP_INPUT_PROMO_FILE_PATH`**</a> - The path to your input file on the provided HTTP server to be concatenated after HTTP_INPUT_FILE_PATH  
Example: `videos/promo.mp4`

<a name="HTTP_INPUT_FILE_PATH_STEREO_SOUND">**`HTTP_INPUT_FILE_PATH_STEREO_SOUND`**</a> - the path to a file containing a video with a single audio stereo stream
Example: `videos/1080p_Sintel_Stereo.mp4`

<a name="HTTP_INPUT_FILE_PATH_SURROUND_SOUND">**`HTTP_INPUT_FILE_PATH_SURROUND_SOUND`**</a> - the path and filename for a file containing a video with a 5.1 audio stream
Example: `videos/1080p_Sintel_Surround.mp4`

<a name="HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS">**`HTTP_INPUT_FILE_PATH_MULTIPLE_MONO_AUDIO_TRACKS`**</a> - the path to a file containing a video with multiple mono audio tracks
Example: `videos/1080p_Sintel_8_Mono_Audio_Tracks.mp4`

<a name="HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS">**`HTTP_INPUT_FILE_PATH_TWO_STEREO_TRACKS`**</a> - the path to a file containing a video with 2 stereo tracks
Example: `videos/1080p_Sintel_Two_Stereos.mp4`

<a name="S3_OUTPUT_BUCKET_NAME">**`S3_OUTPUT_BUCKET_NAME`**</a> - The name of your S3 output bucket  
Example: `my-s3-bucket-name`

<a name="S3_OUTPUT_ACCESS_KEY">**`S3_OUTPUT_ACCESS_KEY`**</a> - The access key of your S3 output bucket  
Example: `AKIAIOSFODNN7EXAMPLE`

<a name="S3_OUTPUT_SECRET_KEY">**`S3_OUTPUT_SECRET_KEY`**</a> - The secret key of your S3 output bucket  
Example: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`

<a name="S3_OUTPUT_BASE_PATH">**`S3_OUTPUT_BASE_PATH`**</a> - The base path on your S3 output bucket where content will be written  
Example: `/outputs`

<a name="WATERMARK_IMAGE_PATH">**`WATERMARK_IMAGE_PATH`**</a> - The path to the watermark image  
Example: `http://my-storage.biz/logo.png`

<a name="TEXT_FILTER_TEXT">**`TEXT_FILTER_TEXT`**</a> - The text to be displayed by the text filter

<a name="DRM_KEY">**`DRM_KEY`**</a> - 16 byte encryption key, represented as 32 hexadecimal characters  
Example: `cab5b529ae28d5cc5e3e7bc3fd4a544d`

<a name="DRM_FAIRPLAY_IV">**`DRM_FAIRPLAY_IV`**</a> - 16 byte initialization vector, represented as 32 hexadecimal characters  
Example: `08eecef4b026deec395234d94218273d`

<a name="DRM_FAIRPLAY_URI">**`DRM_FAIRPLAY_URI`**</a> - URI of the licensing server  
Example: `skd://userspecifc?custom=information`

<a name="DRM_WIDEVINE_KID">**`DRM_WIDEVINE_KID`**</a> - 16 byte encryption key id, represented as 32 hexadecimal characters  
Example: `08eecef4b026deec395234d94218273d`

<a name="DRM_WIDEVINE_PSSH">**`DRM_WIDEVINE_PSSH`**</a> - Base64 encoded PSSH payload  
Example: `QWRvYmVhc2Rmc2FkZmFzZg==`

You may also add your own parameters in your configuration. The ConfigProvider class in each example offers a generic function to get the value of the parameter by its name.
