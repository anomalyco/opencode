package api

import (
	"context"
	"encoding/json"
	"log"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
)

type Request struct {
	Path string          `json:"path"`
	Body json.RawMessage `json:"body"`
}

func Start(ctx context.Context, program *tea.Program, client *opencode.Client) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			var req Request
			if err := client.Get(ctx, "/tui/control/next", nil, &req); err != nil {
				log.Printf("Error getting next request: %v", err)
				continue
			}
			program.Send(req)
		}
	}
}

func Reply(ctx context.Context, client *opencode.Client, response interface{}) tea.Cmd {
	return func() tea.Msg {
		err := client.Post(ctx, "/tui/control/response", response, nil)
		if err != nil {
			return err
		}
		return nil
	}
}
