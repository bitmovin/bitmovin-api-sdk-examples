package common

import (
	"log"
	"time"

	"github.com/bitmovin/bitmovin-api-sdk-go"
	"github.com/bitmovin/bitmovin-api-sdk-go/model"
)

// Starts the actual encoding process and periodically polls its status until it reaches a final state
//
// API endpoints:
//   - https://bitmovin.com/docs/encoding/api-reference/all#/Encoding/PostEncodingEncodingsStartByEncodingId
//   - https://bitmovin.com/docs/encoding/api-reference/sections/encodings#/Encoding/GetEncodingEncodingsStatusByEncodingId
//
// Please note that you can also use our webhooks API instead of polling the status. For more information
// consult the API spec here:
// https://bitmovin.com/docs/encoding/api-reference/sections/notifications-webhooks
func ExecuteEncoding(bitmovinApi *bitmovin.BitmovinAPI, encoding model.Encoding, startEncodingRequest model.StartEncodingRequest) error {
	_, err := bitmovinApi.Encoding.Encodings.StartWithRequestBody(*encoding.Id, startEncodingRequest)
	if err != nil {
		return err
	}

	var task *model.ModelTask
	taskFinished := false
	for err == nil && !taskFinished {
		time.Sleep(5 * time.Second)

		task, err = bitmovinApi.Encoding.Encodings.Status(*encoding.Id)
		log.Printf("Encoding status is %v (progress: %v%%)", task.Status, *task.Progress)

		taskFinished = task.Status == model.Status_FINISHED || task.Status == model.Status_ERROR || task.Status == model.Status_CANCELED
	}

	if err == nil {
		if task.Status == model.Status_ERROR {
			logTaskErrors(task)
		} else {
			log.Printf("Encoding %v finished successfully", *encoding.Id)
		}
	}

	return err
}

func logTaskErrors(task *model.ModelTask) {
	for _, message := range task.Messages {
		if message.Type == model.MessageType_ERROR {
			log.Printf(*message.Text)
		}
	}
}
