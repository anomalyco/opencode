package opencode

import (
	"encoding/json"
	"fmt"
)

// UnmarshalJSON implements custom unmarshaling for the Message union type.
func (m *Message) UnmarshalJSON(data []byte) error {
	// Peek at the "role" field to determine the message type.
	var role struct {
		Role MessageRole `json:"role"`
	}
	if err := json.Unmarshal(data, &role); err != nil {
		return fmt.Errorf("unmarshal message role: %w", err)
	}

	switch role.Role {
	case MessageRoleUser:
		var um UserMessage
		if err := json.Unmarshal(data, &um); err != nil {
			return fmt.Errorf("unmarshal UserMessage: %w", err)
		}
		m.UserMessage = &um
		m.AssistantMessage = nil
	case MessageRoleAssistant:
		var am AssistantMessage
		if err := json.Unmarshal(data, &am); err != nil {
			return fmt.Errorf("unmarshal AssistantMessage: %w", err)
		}
		m.UserMessage = nil
		m.AssistantMessage = &am
	default:
		return fmt.Errorf("unknown message role: %s", role.Role)
	}

	return nil
}

// MarshalJSON implements custom marshaling for the Message union type.
func (m *Message) MarshalJSON() ([]byte, error) {
	if m.UserMessage != nil {
		return json.Marshal(m.UserMessage)
	}
	if m.AssistantMessage != nil {
		return json.Marshal(m.AssistantMessage)
	}
	return json.Marshal(nil)
}

// IsUser returns true if this is a user message.
func (m *Message) IsUser() bool {
	return m.UserMessage != nil
}

// IsAssistant returns true if this is an assistant message.
func (m *Message) IsAssistant() bool {
	return m.AssistantMessage != nil
}
