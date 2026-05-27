package opencode

import (
	"testing"
)

func TestBuildUserMessage(t *testing.T) {
	input := UserMessageInput{
		SessionID: "sess-1",
		Agent:     "test-agent",
		Model:     ModelRef{ProviderID: "p", ModelID: "m"},
	}

	msg := BuildUserMessage(input)

	if msg.Role != MessageRoleUser {
		t.Errorf("expected user role, got %s", msg.Role)
	}
	if msg.SessionID != "sess-1" {
		t.Errorf("expected sessionID sess-1, got %s", msg.SessionID)
	}
	if msg.ID == "" {
		t.Error("expected non-empty ID")
	}
	if msg.Time.Created == 0 {
		t.Error("expected non-zero created time")
	}
}

func TestBuildParts(t *testing.T) {
	inputs := []PartInput{
		{Type: PartTypeText, Text: "hello"},
		{Type: PartTypeReasoning, Text: "thinking..."},
	}

	parts := BuildParts("msg-1", "sess-1", inputs)

	if len(parts) != 2 {
		t.Fatalf("expected 2 parts, got %d", len(parts))
	}
	if parts[0].Type != PartTypeText {
		t.Errorf("expected text part, got %s", parts[0].Type)
	}
	if parts[0].MessageID != "msg-1" {
		t.Errorf("expected messageID msg-1, got %s", parts[0].MessageID)
	}
	if parts[0].ID == "" {
		t.Error("expected non-empty part ID")
	}
}
