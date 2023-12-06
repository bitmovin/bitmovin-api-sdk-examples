set file_name=%1
shift

go mod init github.com/bitmovin/bitmovin-api-sdk-examples
go get github.com/bitmovin/bitmovin-api-sdk-go
mkdir -p build
go build -o build cmd/%file_name%.go

./build/$%file_name%.go %cd%/example.properties %*
