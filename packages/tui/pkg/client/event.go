package client

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/sst/opencode-sdk-go"
)

func Event(c *opencode.Client, url string, ctx context.Context) (<-chan any, error) {
	events := make(chan any)
	req, err := http.NewRequestWithContext(ctx, "GET", url+"event", nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}

	go func() {
		defer close(events)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") {
				data := strings.TrimPrefix(line, "data: ")

				var event opencode.EventListResponse
				if err := json.Unmarshal([]byte(data), &event); err != nil {
					continue
				}

				val := event.AsUnion()

				select {
				case events <- val:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return events, nil
}
