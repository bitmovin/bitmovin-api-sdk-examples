using Bitmovin.Api.Sdk.Models;

namespace Bitmovin.Api.Sdk.Examples.AudioManipulations
{
    public class ChannelMappingConfiguration
    {
        public AudioMixChannelType OutputChannelType { get; }
        public int SourceChannelNumber { get; }

        public ChannelMappingConfiguration(AudioMixChannelType outputChannelType, int sourceChannelNumber)
        {
            OutputChannelType = outputChannelType;
            SourceChannelNumber = sourceChannelNumber;
        }
    }
}