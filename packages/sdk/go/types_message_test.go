package opencode

import (
	"encoding/json"
	"testing"
)

func TestMessageUnmarshalUserMessage(t *testing.T) {
	data := []byte(`{
		"id": "msg-1",
		"sessionID": "sess-1",
		"role": "user",
		"time": {"created": 1717000000000},
		"agent": "test-agent",
		"model": {"providerID": "openai", "modelID": "gpt-4"}
	}`)

	var m Message
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if !m.IsUser() {
		t.Fatal("expected user message")
	}
	if m.IsAssistant() {
		t.Fatal("unexpected assistant")
	}
	if m.UserMessage.ID != "msg-1" {
		t.Errorf("expected id msg-1, got %s", m.UserMessage.ID)
	}
	if m.UserMessage.SessionID != "sess-1" {
		t.Errorf("expected sessionID sess-1, got %s", m.UserMessage.SessionID)
	}
}

func TestMessageUnmarshalAssistantMessage(t *testing.T) {
	data := []byte(`{
		"id": "msg-2",
		"sessionID": "sess-1",
		"role": "assistant",
		"time": {"created": 1717000000000, "completed": 1717000001000},
		"parentID": "msg-1",
		"modelID": "gpt-4",
		"providerID": "openai",
		"mode": "chat",
		"path": {"cwd": "/tmp", "root": "/tmp"},
		"cost": 0.05,
		"tokens": {"input": 100, "output": 50, "reasoning": 0, "cache": {"read": 0, "write": 0}}
	}`)

	var m Message
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if !m.IsAssistant() {
		t.Fatal("expected assistant message")
	}
	if m.IsUser() {
		t.Fatal("unexpected user")
	}
	if m.AssistantMessage.ID != "msg-2" {
		t.Errorf("expected id msg-2, got %s", m.AssistantMessage.ID)
	}
	if m.AssistantMessage.ParentID != "msg-1" {
		t.Errorf("expected parentID msg-1, got %s", m.AssistantMessage.ParentID)
	}
}

func TestMessageMarshalRoundTrip(t *testing.T) {
	original := UserMessage{
		ID:        "msg-3",
		SessionID: "sess-2",
		Role:      MessageRoleUser,
	}
	original.Time.Created = 1717000000000
	original.Agent = "test"
	original.Model = ModelRef{ProviderID: "p", ModelID: "m"}

	m := Message{UserMessage: &original}

	encoded, err := json.Marshal(&m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded Message
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if !decoded.IsUser() {
		t.Fatal("expected user after round-trip")
	}
	if decoded.UserMessage.ID != "msg-3" {
		t.Errorf("round-trip id mismatch: got %s", decoded.UserMessage.ID)
	}
}

func TestMessageUnmarshalUnknownRole(t *testing.T) {
	data := []byte(`{"role": "unknown", "id": "x"}`)
	var m Message
	err := json.Unmarshal(data, &m)
	if err == nil {
		t.Fatal("expected error for unknown role")
	}
}

func TestPartTypes(t *testing.T) {
	partJSON := []byte(`{
		"id": "p-1",
		"sessionID": "s-1",
		"messageID": "m-1",
		"type": "text",
		"text": "hello world"
	}`)

	var p Part
	if err := json.Unmarshal(partJSON, &p); err != nil {
		t.Fatalf("unmarshal part: %v", err)
	}
	if p.Type != PartTypeText {
		t.Errorf("expected text type, got %s", p.Type)
	}
	if p.Text != "hello world" {
		t.Errorf("expected 'hello world', got %s", p.Text)
	}
}
