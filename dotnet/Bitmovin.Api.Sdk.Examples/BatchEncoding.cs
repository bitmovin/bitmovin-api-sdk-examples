using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Bitmovin.Api.Sdk.Common;
using Bitmovin.Api.Sdk.Common.Logging;
using Bitmovin.Api.Sdk.Models;
using Bitmovin.Api.Sdk.Examples.common;
using Stream = Bitmovin.Api.Sdk.Models.Stream;

namespace Bitmovin.Api.Sdk.Examples
{
    /// <summary>
    /// <para>This example demonstrates how to efficiently execute a large batch of encodings in parallel. In
    /// order to keep the startup time for each encoding to a minimum, it is advisable to constantly have
    /// some encodings queued. Encodings will therefore be started in a way to maintain a constant queue
    /// size.</para>
    ///
    /// <para>The same list of jobs will be executed on each start. In order to continue a batch after
    /// restarting, you will have to extend the JobDispatcher class to use a persistent data store (e.g.
    /// a database)</para>
    ///
    /// <para>Be aware that our webhooks API provides a more advanced way to keep track of your encodings
    /// than constantly polling their status. This approach has been chosen solely for reasons of
    /// simplicity.</para>
    ///
    /// <br />
    /// The following configuration parameters are expected:
    /// <list type="bullet">
    /// <item>
    /// <term>BITMOVIN_API_KEY</term>
    /// <description>Your API key for the Bitmovin API</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_HOST</term>
    /// <description>The Hostname or IP address of the HTTP server hosting your input files, e.g.: my-storage.biz</description>
    /// </item>
    /// <item>
    /// <term>HTTP_INPUT_FILE_PATH</term>
    /// <description>The path to your input file on the provided HTTP server Example:
    ///     videos/1080p_Sintel.mp4</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_BUCKET_NAME</term>
    /// <description>The name of your S3 output bucket. Example: my-bucket-name</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_ACCESS_KEY</term>
    /// <description>The access key of your S3 output bucket</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_SECRET_KEY</term>
    /// <description>The secret key of your S3 output bucket</description>
    /// </item>
    /// <item>
    /// <term>S3_OUTPUT_BASE_PATH</term>
    /// <description>The base path on your S3 output bucket where content will be written.
    /// Example: /outputs</description>
    /// </item>
    /// </list>
    /// <br />
    ///
    /// Configuration parameters will be retrieved from these sources in the listed order:
    /// <list type="bullet">
    /// <item>
    /// <term>command line arguments</term>
    /// <description>(eg BITMOVIN_API_KEY=xyz)</description>
    /// </item>
    /// <item>
    /// <term>properties file located in the root folder of the C# examples at ./examples.properties</term> 
    /// <description>(see examples.properties.template as reference)</description>
    /// </item>
    /// <item>
    /// <term>environment variables</term>
    /// </item>
    /// <item>
    /// <term>properties file located in the home folder at ~/.bitmovin/examples.properties</term>
    /// <description>(see examples.properties.template as reference)</description>
    /// </item>
    /// </list>
    /// </summary>
    public class BatchEncoding : IExample
    {
        private static ConfigProvider _configProvider;
        private BitmovinApi _bitmovinApi;

        /// <summary>
        /// The example will strive to always keep this number of encodings in state 'queued'.<para />
        /// Make sure not to choose a size larger than your queue size limit in the Bitmovin platform, otherwise
        /// encoding start calls will fail.
        /// </summary>
        private const int TargetQueueSize = 3;

        /// <summary>
        /// The maximum number of retries per job, in case the start call or the encoding process is not
        /// successful. However, no retries will be performed after receiving an error that is considered
        /// permanent. Error code 8004 (platform queue limit exceeded) will always be retried.
        /// </summary>
        private const int MaxRetries = 2;

        public async Task RunExample(string[] args)
        {
            _configProvider = new ConfigProvider(Environment.GetCommandLineArgs());
            _bitmovinApi = BitmovinApi.Builder
                .WithApiKey(_configProvider.GetBitmovinApiKey())
                .WithLogger(new ConsoleLogger())
                .Build();

            var input = await CreateHttpInput(_configProvider.GetHttpInputHost());
            var output = await CreateS3Output(_configProvider.GetS3OutputBucketName(),
                _configProvider.GetS3OutputAccessKey(),
                _configProvider.GetS3OutputSecretKey());

            var codecConfigurations = new List<CodecConfiguration>()
            {
                await CreateH264VideoConfiguration(480, 800_000L),
                await CreateH264VideoConfiguration(720, 1_200_000L),
                await CreateH264VideoConfiguration(1080, 2_000_000L),
                await CreateAacAudioConfiguration()
            };

            var jobDispatcher = new JobDispatcher();

            do
            {
                var queuedEncodings = await CountQueuedEncodings();
                var freeSlots = TargetQueueSize - queuedEncodings;

                if (freeSlots > 0)
                {
                    var jobsToStart = jobDispatcher.GetJobsToStart(freeSlots);

                    if (jobsToStart.Count > 0)
                    {
                        Console.WriteLine($"There are currently {queuedEncodings} encodings queued. " +
                                          $"Starting {jobsToStart.Count} more to reach target queue size " +
                                          $"of {TargetQueueSize}");

                        await StartEncodings(jobsToStart, codecConfigurations, input, output);
                    }
                    else
                    {
                        Console.WriteLine("No more jobs to start. Waiting for " +
                                          $"{jobDispatcher.GetStartedJobs().Count} jobs to finish.");
                    }
                }
                else
                {
                    Console.WriteLine($"There are currently {queuedEncodings} encodings queued. " +
                                      "Waiting for free slots...");
                }

                await Task.Delay(10000);
                foreach (var job in jobDispatcher.GetStartedJobs())
                {
                    await UpdateEncodingJob(job);
                    await Task.Delay(300);
                }
            } while (!jobDispatcher.AllJobsFinished());

            Console.WriteLine("All encodings jobs are finished!");

            jobDispatcher.LogFailedJobs();
        }

        /// <summary>
        /// This method will start new encodings created from {@link EncodingJob} objects and update the
        /// started {@link EncodingJob} objects
        /// </summary>
        /// <param name="jobsToStart">The encoding jobs that should be started</param>
        /// <param name="codecConfigurations">A list of codec configurations representing the different video- and audio
        /// renditions to be generated</param>
        /// <param name="input">The input that should be used for that encodings</param>
        /// <param name="output">The output that should be used for that encodings</param>
        private async Task StartEncodings(List<EncodingJob> jobsToStart, List<CodecConfiguration> codecConfigurations,
            Input input, Output output)
        {
            foreach (var job in jobsToStart)
            {
                if (string.IsNullOrEmpty(job.EncodingId))
                {
                    var encoding = await CreateAndConfigureEncoding(input, job.InputFilePath, codecConfigurations,
                        job.EncodingName, output, job.OutputPath);
                    job.EncodingId = encoding.Id;
                }

                try
                {
                    await _bitmovinApi.Encoding.Encodings.StartAsync(job.EncodingId);
                    job.Status = EncodingJobStatus.Started;
                    Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') has been started.");
                }
                catch (BitmovinApiException ex)
                {
                    if (ex.ErrorData.Code == 8004)
                    {
                        Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') could not be started " +
                                          "because your platform limit for queued encodings has been reached. " +
                                          "Will retry.");
                        return;
                    }

                    job.RetryCount++;
                    if (job.RetryCount > MaxRetries)
                    {
                        Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') has reached the maximum " +
                                          "number of retries. Giving up.");
                        job.Status = EncodingJobStatus.GivenUp;
                        job.ErrorMessages.Add("The encoding could not be started: " + ex.Message);
                    }
                }

                await Task.Delay(300);
            }
        }

        /// <summary>
        /// This checks the status of the associated encoding of the encoding job and would update the
        /// encoding job in the repository.
        /// </summary>
        /// <param name="job">The encoding job to update</param>
        private async Task UpdateEncodingJob(EncodingJob job)
        {
            var serviceTaskStatus = await _bitmovinApi.Encoding.Encodings.StatusAsync(job.EncodingId);

            switch (serviceTaskStatus.Status)
            {
                case Status.FINISHED:
                    job.Status = EncodingJobStatus.Successful;
                    break;
                case Status.ERROR when !IsRetryableError(serviceTaskStatus):
                    Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') failed with a permanent " +
                                      "error. Giving up.");
                    job.Status = EncodingJobStatus.GivenUp;
                    job.ErrorMessages = job.ErrorMessages.Concat(GetErrorMessages(serviceTaskStatus)).ToList();
                    break;
                case Status.ERROR when job.RetryCount > MaxRetries:
                    Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') has reached the maximum " +
                                      "number of retries. Giving up.");
                    job.Status = EncodingJobStatus.GivenUp;
                    job.ErrorMessages = job.ErrorMessages.Concat(GetErrorMessages(serviceTaskStatus)).ToList();
                    break;
                case Status.ERROR:
                    Console.WriteLine($"Encoding {job.EncodingId} ('{job.EncodingName}') has failed. Will attempt " +
                                      $"{MaxRetries - job.RetryCount} more retries.");
                    job.RetryCount++;
                    job.Status = EncodingJobStatus.Waiting;
                    break;
            }
        }

        private bool IsRetryableError(ServiceTaskStatus task)
        {
            return task.Status == Status.ERROR && task.Error != null && task.Error.RetryHint != RetryHint.NO_RETRY;
        }

        private List<string> GetErrorMessages(ServiceTaskStatus task)
        {
            return task.Messages
                .Where(msg => msg.Type == MessageType.ERROR)
                .Select(msg => msg.Text)
                .ToList();
        }

        /// <summary>
        /// Creates an Encoding object and adds a stream and a muxing for each codec configuration to it.
        /// This creates a fully configured encoding.
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodings
        /// </summary>
        /// <param name="input">The input that should be used for the encoding</param>
        /// <param name="inputPath">The path to the input file which should be used for the encoding</param>
        /// <param name="codecConfigurations">A list of codec configurations representing the different video- and audio
        /// renditions to be generated</param>
        /// <param name="encodingName">A name for the encoding</param>
        /// <param name="output">The output that should be used for the encoding</param>
        /// <param name="outputPath">The path where the content will be written to</param>
        private async Task<Models.Encoding> CreateAndConfigureEncoding(Input input, string inputPath,
            List<CodecConfiguration> codecConfigurations, string encodingName, Output output, string outputPath)
        {
            var encoding = new Models.Encoding()
            {
                Name = encodingName
            };

            encoding = await _bitmovinApi.Encoding.Encodings.CreateAsync(encoding);

            foreach (var codecConfig in codecConfigurations)
            {
                var stream = await CreateStream(encoding, input, inputPath, codecConfig);

                string muxingOutputPath;
                if (codecConfig is VideoConfiguration)
                {
                    muxingOutputPath = $"{outputPath}/video/{((VideoConfiguration) codecConfig).Height}";
                }
                else
                {
                    muxingOutputPath = $"{outputPath}/audio/{((AudioConfiguration) codecConfig).Bitrate / 1000}";
                }

                await CreateFmp4Muxing(encoding, stream, output, muxingOutputPath);
            }

            return encoding;
        }

        /// <summary>
        ///  This method queries the encodings currently in QUEUED state and returns the total result count of that query
        /// </summary>
        private async Task<long> CountQueuedEncodings()
        {
            var encodingPage = await _bitmovinApi.Encoding.Encodings.ListAsync(q => q.Status("QUEUED"));

            if (encodingPage.TotalCount == null)
            {
                return 0;
            }

            return (long) encodingPage.TotalCount;
        }

        /// <summary>
        /// <para>Creates a resource representing an HTTP server providing the input files. For alternative input
        /// methods see list of supported input and output storages
        /// (https://bitmovin.com/docs/encoding/articles/supported-input-output-storages)</para>
        /// 
        /// <para>For reasons of simplicity, a new input resource is created on each execution of this
        /// example. In production use, this method should be replaced by a get call to retrieve an existing resource.
        /// (https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/GetEncodingInputsHttpByInputId) 
        /// </para>
        /// 
        /// <para>API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/inputs#/Encoding/PostEncodingInputsHttp
        /// </para>
        /// </summary>
        /// <param name="host">The hostname or IP address of the HTTP server e.g.: my-storage.biz</param> 
        private Task<HttpInput> CreateHttpInput(string host)
        {
            var input = new HttpInput()
            {
                Host = host
            };

            return _bitmovinApi.Encoding.Inputs.Http.CreateAsync(input);
        }

        /// <summary>
        /// <para>Creates a resource representing an AWS S3 cloud storage bucket to which generated content will
        /// be transferred. For alternative output methods see
        /// https://bitmovin.com/docs/encoding/articles/supported-input-output-storages for the list of
        /// supported input and output storages.</para>
        ///
        /// <para>The provided credentials need to allow read, write and list operations.
        /// Delete should also be granted to allow overwriting of existing files. See
        /// https://bitmovin.com/docs/encoding/faqs/how-do-i-create-a-aws-s3-bucket-which-can-be-used-as-output-location
        /// for creating an S3 bucket and setting permissions for further information</para>
        ///
        /// <para>For reasons of simplicity, a new output resource is created on each execution of this
        /// example. In production use, this method should be replaced by a get call
        /// (https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/GetEncodingOutputsS3)
        /// retrieving an existing resource</para>
        ///
        /// <para>API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/outputs#/Encoding/PostEncodingOutputsS3
        /// </para>
        /// </summary>
        /// <param name="bucketName">The name of the S3 bucket</param> 
        /// <param name="accessKey">The access key of your S3 account</param>
        /// <param name="secretKey">The secret key of your S3 account</param>
        private Task<S3Output> CreateS3Output(string bucketName, string accessKey, string secretKey)
        {
            var s3Output = new S3Output()
            {
                BucketName = bucketName,
                AccessKey = accessKey,
                SecretKey = secretKey
            };

            return _bitmovinApi.Encoding.Outputs.S3.CreateAsync(s3Output);
        }

        /// <summary>
        /// Creates a configuration for the H.264 video codec to be applied to video streams.<para />
        ///
        /// The output resolution is defined by setting the height to 1080 pixels. Width will be determined
        /// automatically to maintain the aspect ratio of your input video.<para />
        ///
        /// To keep things simple, we use a quality-optimized VoD preset configuration, which will apply proven settings
        /// for the codec. See How to optimize your H264 codec configuration for different use-cases
        /// (https://bitmovin.com/docs/encoding/tutorials/how-to-optimize-your-h264-codec-configuration-for-different-use-cases)
        /// for alternative presets.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsVideoH264
        /// <param name="height">The height of the output video</param>
        /// <param name="bitrate">The target bitrate of the output video</param>
        /// </summary>
        private Task<H264VideoConfiguration> CreateH264VideoConfiguration(int height, long bitrate)
        {
            var config = new H264VideoConfiguration()
            {
                Name = $"H.264 {height}p {bitrate / 1000000} Mbit/s",
                PresetConfiguration = PresetConfiguration.VOD_STANDARD,
                Height = height,
                Bitrate = bitrate
            };

            return _bitmovinApi.Encoding.Configurations.Video.H264.CreateAsync(config);
        }

        /// <summary>
        /// Creates a configuration for the AAC audio codec to be applied to audio streams.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/configurations#/Encoding/PostEncodingConfigurationsAudioAac
        /// </summary>
        private Task<AacAudioConfiguration> CreateAacAudioConfiguration()
        {
            var config = new AacAudioConfiguration()
            {
                Name = "AAC 128 kbit/s",
                Bitrate = 128_000L
            };

            return _bitmovinApi.Encoding.Configurations.Audio.Aac.CreateAsync(config);
        }

        /// <summary>
        /// Creates a fragmented MP4 muxing. This will generate segments with a given segment length for
        /// adaptive streaming.<para />
        ///
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsMuxingsFmp4ByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the FMP4 muxing to</param>
        /// <param name="stream">The encoding to add the FMP4 muxing to</param>
        /// <param name="output">The encoding to add the FMP4 muxing to</param>
        /// <param name="outputPath">The encoding to add the FMP4 muxing to</param>
        private Task CreateFmp4Muxing(Models.Encoding encoding, Stream stream, Output output,
            string outputPath)
        {
            var muxingStream = new MuxingStream()
            {
                StreamId = stream.Id
            };

            var muxing = new Fmp4Muxing()
            {
                Outputs = new List<EncodingOutput>() {BuildEncodingOutput(output, outputPath)},
                Streams = new List<MuxingStream>() {muxingStream},
                SegmentLength = 4.0
            };

            return _bitmovinApi.Encoding.Encodings.Muxings.Fmp4.CreateAsync(encoding.Id, muxing);
        }

        /// <summary>
        /// Creates a stream which binds an input file to a codec configuration.
        /// The stream is used for muxings later on.<para />
        /// 
        /// API endpoint:
        /// https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/PostEncodingEncodingsStreamsByEncodingId
        /// </summary>
        /// <param name="encoding">The encoding to add the stream onto</param>
        /// <param name="input">The input that should be used</param>
        /// <param name="inputPath">The path to the input file</param>
        /// <param name="configuration">The codec configuration to be applied to the stream</param>
        private Task<Stream> CreateStream(Models.Encoding encoding, Input input, string inputPath,
            CodecConfiguration configuration)
        {
            var streamInput = new StreamInput()
            {
                InputId = input.Id,
                InputPath = inputPath,
                SelectionMode = StreamSelectionMode.AUTO
            };

            var stream = new Stream()
            {
                InputStreams = new List<StreamInput>() {streamInput},
                CodecConfigId = configuration.Id
            };

            return _bitmovinApi.Encoding.Encodings.Streams.CreateAsync(encoding.Id, stream);
        }

        /// <summary>
        /// Builds an EncodingOutput object which defines where the output content (e.g. of a muxing) will
        /// be written to. Public read permissions will be set for the files written, so they can be
        /// accessed easily via HTTP.
        /// </summary>
        /// <param name="output">The output resource to be used by the EncodingOutput</param>
        /// <param name="outputPath">The path where the content will be written to</param>
        private EncodingOutput BuildEncodingOutput(Output output, string outputPath)
        {
            var aclEntry = new AclEntry()
            {
                Permission = AclPermission.PUBLICREAD
            };

            var encodingOutput = new EncodingOutput()
            {
                OutputPath = BuildAbsolutePath(outputPath),
                OutputId = output.Id,
                Acl = new List<AclEntry>() {aclEntry}
            };

            return encodingOutput;
        }

        /// <summary>
        /// Builds an absolute path by concatenating the S3_OUTPUT_BASE_PATH configuration parameter, the
        /// name of this example class and the given relative path<para />
        /// 
        /// e.g.: /s3/base/path/ClassName/relative/path
        /// </summary>
        /// <param name="relativePath">The relative path that is concatenated</param>
        private string BuildAbsolutePath(string relativePath)
        {
            return Path.Join(_configProvider.GetS3OutputBasePath(), nameof(BatchEncoding), relativePath);
        }

        /// <summary>
        /// Helper class managing the encodings to be processed in the batch<para />
        ///
        /// NOTE: This is a dummy implementation that will process the same jobs on each execution of
        /// the example. For production use, we suggest using a persistent data store (eg. a database) to
        /// save and reload the job list.<para />
        /// </summary>
        private class JobDispatcher
        {
            private List<EncodingJob> _encodingJobs;

            public JobDispatcher()
            {
                _encodingJobs = new List<EncodingJob>();
                var inputFilePath = _configProvider.GetHttpInputFilePath();
                var outputFilePath = _configProvider.GetS3OutputBasePath();

                var maxJobCount = 8;
                for (var i = 1; i < maxJobCount; i++)
                {
                    var encodingName = $"encoding{i}";
                    _encodingJobs.Add(new EncodingJob(inputFilePath,
                        Path.Join(outputFilePath, encodingName),
                        encodingName));
                }
            }

            public List<EncodingJob> GetJobsToStart(long limit)
            {
                return _encodingJobs
                    .Where(job => job.Status == EncodingJobStatus.Waiting)
                    .Take((int) limit)
                    .ToList();
            }

            public List<EncodingJob> GetStartedJobs()
            {
                return _encodingJobs
                    .Where(job => job.Status == EncodingJobStatus.Started)
                    .ToList();
            }

            public bool AllJobsFinished()
            {
                return _encodingJobs
                    .All(job => job.Status == EncodingJobStatus.Successful
                                || job.Status == EncodingJobStatus.GivenUp);
            }

            public void LogFailedJobs()
            {
                foreach (var encodingJob in _encodingJobs.Where(job => job.Status == EncodingJobStatus.GivenUp))
                {
                    Console.WriteLine($"Encoding {encodingJob.EncodingId} ('{encodingJob.EncodingName}') could not " +
                                      "be finished successfully: ");
                    LogEncodingErrors(encodingJob.ErrorMessages);
                }
            }

            /// <summary>
            /// Print all encoding errors
            /// </summary>
            /// <param name="task">List with the errors</param>
            private void LogEncodingErrors(List<string> task)
            {
                foreach (var message in task)
                {
                    Console.WriteLine(message);
                }
            }
        }

        private class EncodingJob
        {
            public string EncodingName;
            public string InputFilePath;
            public string OutputPath;
            public string EncodingId;
            public int RetryCount;
            public EncodingJobStatus Status;
            public List<string> ErrorMessages = new List<string>();

            public EncodingJob(string inputFilePath, string outputPath, string encodingName)
            {
                InputFilePath = inputFilePath;
                OutputPath = outputPath;
                EncodingName = encodingName;
                Status = EncodingJobStatus.Waiting;
            }
        }

        private enum EncodingJobStatus
        {
            Waiting,
            Started,
            Successful,
            GivenUp
        }
    }
}
