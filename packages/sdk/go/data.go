package opencode

import (
	"fmt"
	"sync/atomic"
	"time"
)

// UserMessageInput is the input for constructing a user message.
type UserMessageInput struct {
	SessionID string
	Agent     string
	Model     ModelRef
	System    string
	Tools     map[string]bool
	Parts     []PartInput
}

// PartInput is the input for constructing a part.
type PartInput struct {
	Type       PartType
	Text       string
	Tool       string
	State      map[string]interface{}
	FileSource *FilePartSource
}

// BuildUserMessage constructs a UserMessage from input.
func BuildUserMessage(input UserMessageInput) *UserMessage {
	id := generateID()
	return &UserMessage{
		ID:        id,
		SessionID: input.SessionID,
		Role:      MessageRoleUser,
		Time: struct {
			Created int64 `json:"created"`
		}{
			Created: time.Now().UnixMilli(),
		},
		Agent: input.Agent,
		Model: input.Model,
		System: input.System,
		Tools:  input.Tools,
	}
}

// BuildParts constructs Part objects from PartInputs.
func BuildParts(msgID, sessionID string, inputs []PartInput) []Part {
	parts := make([]Part, len(inputs))
	for i, p := range inputs {
		parts[i] = Part{
			ID:        generateID(),
			SessionID: sessionID,
			MessageID: msgID,
			Type:      p.Type,
			Text:      p.Text,
			Tool:      p.Tool,
			State:     p.State,
		}
	}
	return parts
}

var idCounter atomic.Int64

func generateID() string {
	n := idCounter.Add(1)
	return fmt.Sprintf("gomsg_%d_%d", time.Now().UnixMilli(), n)
}
