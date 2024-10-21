#!/bin/bash
example_name=$1
shift

go mod init github.com/bitmovin/bitmovin-api-sdk-examples
go get github.com/bitmovin/bitmovin-api-sdk-go
mkdir -p build
go build -o build cmd/${example_name}/main.go

./build/${example_name} $PWD/examples.properties "$@"
