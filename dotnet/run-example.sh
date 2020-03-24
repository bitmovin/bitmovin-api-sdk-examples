#!/bin/bash
file_name=$1
shift

dotnet run --project Bitmovin.Api.Sdk.Examples/Bitmovin.Api.Sdk.Examples.csproj $file_name "$@"
