package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/bridge"
)

var version = "0.0.1"
var LAMBDA_RUNTIME_API = os.Getenv("AWS_LAMBDA_RUNTIME_API")
var SST_APP = os.Getenv("SST_APP")
var SST_STAGE = os.Getenv("SST_STAGE")
var SST_FUNCTION_ID = os.Getenv("SST_FUNCTION_ID")
var SST_FUNCTION_TIMEOUT = os.Getenv("SST_FUNCTION_TIMEOUT")
var SST_REGION = os.Getenv("SST_REGION")
var SST_ASSET_BUCKET = os.Getenv("SST_ASSET_BUCKET")
var SST_APPSYNC_HTTP = os.Getenv("SST_APPSYNC_HTTP")
var SST_APPSYNC_REALTIME = os.Getenv("SST_APPSYNC_REALTIME")

var ENV_BLACKLIST = map[string]bool{
	"SST_DEBUG_ENDPOINT":              true,
	"SST_DEBUG_SRC_HANDLER":           true,
	"SST_DEBUG_SRC_PATH":              true,
	"AWS_LAMBDA_FUNCTION_MEMORY_SIZE": true,
	"AWS_LAMBDA_LOG_GROUP_NAME":       true,
	"AWS_LAMBDA_LOG_STREAM_NAME":      true,
	"LD_LIBRARY_PATH":                 true,
	"LAMBDA_TASK_ROOT":                true,
	"AWS_LAMBDA_RUNTIME_API":          true,
	"AWS_EXECUTION_ENV":               true,
	"AWS_XRAY_DAEMON_ADDRESS":         true,
	"AWS_LAMBDA_INITIALIZATION_TYPE":  true,
	"PATH":                            true,
	"PWD":                             true,
	"LAMBDA_RUNTIME_DIR":              true,
	"LANG":                            true,
	"NODE_PATH":                       true,
	"SHLVL":                           true,
	"AWS_XRAY_DAEMON_PORT":            true,
	"AWS_XRAY_CONTEXT_MISSING":        true,
	"_HANDLER":                        true,
	"_LAMBDA_CONSOLE_SOCKET":          true,
	"_LAMBDA_CONTROL_SOCKET":          true,
	"_LAMBDA_LOG_FD":                  true,
	"_LAMBDA_RUNTIME_LOAD_TIME":       true,
	"_LAMBDA_SB_ID":                   true,
	"_LAMBDA_SERVER_PORT":             true,
	"_LAMBDA_SHARED_MEM_FD":           true,
}

func main() {
	err := run()
	if err != nil {
		slog.Error("run failed", "err", err)
	}
}

func run() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGHUP)

	go func() {
		slog.Info("waiting for interrupt signal")
		<-sigs
		slog.Info("got interrupt signal")
		cancel()
	}()
	defer cancel()

	logStreamName := os.Getenv("AWS_LAMBDA_LOG_STREAM_NAME")
	workerID := logStreamName[len(logStreamName)-32:]
	prefix := fmt.Sprintf("/sst/%s/%s", SST_APP, SST_STAGE)
	fmt.Println("prefix", prefix)
	config, err := config.LoadDefaultConfig(ctx, config.WithRegion(SST_REGION))
	if err != nil {
		return err
	}

	conn, err := appsync.Dial(ctx, config, SST_APPSYNC_HTTP, SST_APPSYNC_REALTIME)
	if err != nil {
		return err
	}
	client := bridge.NewClient(ctx, conn, workerID, prefix+"/"+workerID)

	init := bridge.InitBody{
		FunctionID:  SST_FUNCTION_ID,
		Environment: []string{},
	}
	for _, e := range os.Environ() {
		key := strings.Split(e, "=")[0]
		if _, ok := ENV_BLACKLIST[key]; ok {
			continue
		}
		init.Environment = append(init.Environment, e)
	}
	writer := client.NewWriter(bridge.MessageInit, prefix+"/in")
	json.NewEncoder(writer).Encode(init)
	writer.Close()

	notRunning, _ := json.Marshal(map[string]string{
		"statusCode": "500",
		"body":       "sst dev is not running (worker: " + workerID + ")",
	})

	for {
		resp, err := http.Get("http://" + LAMBDA_RUNTIME_API + "/2018-06-01/runtime/invocation/next")
		fmt.Println("status", resp.Status)
		if err != nil {
			cancel()
			return err
		}
		requestID := resp.Header.Get("lambda-runtime-aws-request-id")
		writer := client.NewWriter(bridge.MessageNext, prefix+"/in")
		err = resp.Write(writer)
		if err != nil {
			slog.Error("failed to write message", slog.String("requestID", requestID), slog.String("error", err.Error()))
			continue
		}
		err = writer.Close()
		if err != nil {
			slog.Error("failed to close message", slog.String("requestID", requestID), slog.String("error", err.Error()))
			continue
		}
		timeout := time.Second * 16

	loop:
		for {
			select {
			case <-ctx.Done():
				return nil
			case msg := <-client.Read():
				fmt.Println("got message", msg.Type)
				if msg.Type == bridge.MessageResponse && msg.ID == requestID {
					http.Post("http://"+LAMBDA_RUNTIME_API+"/2018-06-01/runtime/invocation/"+requestID+"/response", "application/json", msg.Body)
					break loop
				}
				if msg.Type == bridge.MessageError && msg.ID == requestID {
					http.Post("http://"+LAMBDA_RUNTIME_API+"/2018-06-01/runtime/invocation/"+requestID+"/error", "application/json", msg.Body)
					break loop
				}
				if msg.Type == bridge.MessageInitError {
					http.Post("http://"+LAMBDA_RUNTIME_API+"/2018-06-01/runtime/invocation/"+requestID+"/error", "application/json", msg.Body)
					break loop
				}
				if msg.Type == bridge.MessageReboot {
					writer := client.NewWriter(bridge.MessageInit, prefix+"/in")
					json.NewEncoder(writer).Encode(init)
					writer.Close()
					continue
				}
				if msg.Type == bridge.MessagePing {
					timeout = time.Minute * 15
					continue
				}
			case <-time.After(timeout):
				fmt.Println("timeout", requestID)
				http.Post("http://"+LAMBDA_RUNTIME_API+"/2018-06-01/runtime/invocation/"+requestID+"/response", "application/json", bytes.NewReader(notRunning))
				break loop
			}
		}
	}

}
