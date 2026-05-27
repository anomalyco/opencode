package opencode

import (
	"net/url"
	"testing"
)

func TestNewClientDefaults(t *testing.T) {
	c := NewClient(nil)

	if c.baseURL != "http://localhost:4096" {
		t.Errorf("expected default baseURL, got %s", c.baseURL)
	}
	if c.Global == nil {
		t.Error("Global client is nil")
	}
	if c.Session == nil {
		t.Error("Session client is nil")
	}
	if c.Experimental == nil {
		t.Error("Experimental client is nil")
	}
	if c.Permission == nil {
		t.Error("Permission client is nil")
	}
	if c.Question == nil {
		t.Error("Question client is nil")
	}
	if c.Sync == nil {
		t.Error("Sync client is nil")
	}
	if c.Skill == nil {
		t.Error("Skill client is nil")
	}
	if c.Agent == nil {
		t.Error("Agent client is nil")
	}
	if c.Event == nil {
		t.Error("Event client is nil")
	}
}

func TestNewClientCustomBaseURL(t *testing.T) {
	c := NewClient(&Config{
		BaseURL: "http://example.com:8080",
	})

	if c.baseURL != "http://example.com:8080" {
		t.Errorf("expected custom baseURL, got %s", c.baseURL)
	}
}

func TestNewClientDirectoryHeader(t *testing.T) {
	c := NewClient(&Config{
		Directory: "/home/user/project",
	})

	val := c.headers["x-opencode-directory"]
	expected := url.QueryEscape("/home/user/project")
	if val != expected {
		t.Errorf("expected directory header %s, got %s", expected, val)
	}
}

func TestNewClientWorkspaceHeader(t *testing.T) {
	c := NewClient(&Config{
		ExperimentalWorkspace: "ws-123",
	})

	val := c.headers["x-opencode-workspace"]
	if val != "ws-123" {
		t.Errorf("expected workspace header, got %s", val)
	}
}
