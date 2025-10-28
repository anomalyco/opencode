// Test file for verifying the fix for "bufio.Scanner: token too long" error
// This tests that the SSE stream decoder can handle events larger than 32MB

package ssestream

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// mockReadCloser wraps a buffer and implements io.ReadCloser
type mockReadCloser struct {
	*bytes.Reader
}

func (m *mockReadCloser) Close() error {
	return nil
}

// createSSEEvent creates an SSE event with specified data size
func createSSEEvent(eventType string, dataSize int) string {
	var builder strings.Builder

	// Write event type
	if eventType != "" {
		builder.WriteString("event: ")
		builder.WriteString(eventType)
		builder.WriteString("\n")
	}

	// Write data field - create JSON-like data to make it realistic
	builder.WriteString("data: {\"content\":\"")

	// Add padding to reach desired size
	remaining := dataSize - 20 // Account for JSON structure
	if remaining > 0 {
		// Write in chunks to avoid memory issues during test creation
		chunkSize := 1024
		for remaining > 0 {
			size := chunkSize
			if size > remaining {
				size = remaining
			}
			builder.WriteString(strings.Repeat("x", size))
			remaining -= size
		}
	}

	builder.WriteString("\"}\n")
	builder.WriteString("\n") // Empty line signals end of event

	return builder.String()
}

// TestSmallEvent tests events well within buffer size (baseline)
func TestSmallEvent(t *testing.T) {
	// 1KB event
	event := createSSEEvent("test", 1024)

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "test" {
		t.Errorf("Expected event type 'test', got '%s'", evt.Type)
	}

	if len(evt.Data) == 0 {
		t.Error("Expected non-empty data")
	}
}

// TestMediumEvent tests events within initial 1MB buffer
func TestMediumEvent(t *testing.T) {
	// 100KB event
	event := createSSEEvent("medium", 100*1024)

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "medium" {
		t.Errorf("Expected event type 'medium', got '%s'", evt.Type)
	}
}

// TestLargeEvent tests events larger than initial buffer but smaller than old limit
func TestLargeEvent(t *testing.T) {
	// 10MB event - larger than 1MB buffer, but bufio.Reader will grow
	event := createSSEEvent("large", 10*1024*1024)

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "large" {
		t.Errorf("Expected event type 'large', got '%s'", evt.Type)
	}

	// Verify data is roughly the expected size (accounting for JSON structure)
	dataSize := len(evt.Data)
	expectedMin := 9 * 1024 * 1024  // At least 9MB
	expectedMax := 11 * 1024 * 1024 // At most 11MB

	if dataSize < expectedMin || dataSize > expectedMax {
		t.Errorf("Data size %d not in expected range [%d, %d]", dataSize, expectedMin, expectedMax)
	}
}

// TestVeryLargeEvent - CRITICAL TEST
// This tests events larger than the old 32MB scanner limit
// This would FAIL with the old bufio.Scanner implementation
func TestVeryLargeEvent(t *testing.T) {
	// 50MB event - exceeds old 32MB limit
	t.Log("Creating 50MB SSE event...")
	event := createSSEEvent("verylarge", 50*1024*1024)
	t.Logf("Event created, size: %d bytes", len(event))

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	t.Log("Decoding 50MB event...")
	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v (THIS WOULD FAIL WITH OLD SCANNER)", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "verylarge" {
		t.Errorf("Expected event type 'verylarge', got '%s'", evt.Type)
	}

	// Verify data is roughly the expected size
	dataSize := len(evt.Data)
	expectedMin := 48 * 1024 * 1024 // At least 48MB
	expectedMax := 52 * 1024 * 1024 // At most 52MB

	if dataSize < expectedMin || dataSize > expectedMax {
		t.Errorf("Data size %d not in expected range [%d, %d]", dataSize, expectedMin, expectedMax)
	}

	t.Logf("✅ SUCCESS: Processed 50MB event (old scanner would fail at 32MB)")
}

// TestExtremeEvent tests extremely large events
func TestExtremeEvent(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping extreme test in short mode")
	}

	// 100MB event
	t.Log("Creating 100MB SSE event...")
	event := createSSEEvent("extreme", 100*1024*1024)
	t.Logf("Event created, size: %d bytes", len(event))

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	t.Log("Decoding 100MB event...")
	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "extreme" {
		t.Errorf("Expected event type 'extreme', got '%s'", evt.Type)
	}

	t.Logf("✅ SUCCESS: Processed 100MB event")
}

// TestMultipleLargeEvents tests streaming multiple large events
func TestMultipleLargeEvents(t *testing.T) {
	var builder strings.Builder

	// Create 3 large events (5MB each)
	for i := 0; i < 3; i++ {
		eventName := fmt.Sprintf("event%d", i)
		builder.WriteString(createSSEEvent(eventName, 5*1024*1024))
	}

	mockBody := &mockReadCloser{bytes.NewReader([]byte(builder.String()))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	// Read all 3 events
	for i := range 3 {
		if !decoder.Next() {
			t.Fatalf("Expected event %d, got error: %v", i, decoder.Err())
		}

		evt := decoder.Event()
		expectedType := fmt.Sprintf("event%d", i)
		if evt.Type != expectedType {
			t.Errorf("Expected event type '%s', got '%s'", expectedType, evt.Type)
		}
	}

	// Should be no more events
	if decoder.Next() {
		t.Error("Expected no more events")
	}
}

// TestEmptyEvent tests that empty events still work
func TestEmptyEvent(t *testing.T) {
	event := "event: empty\ndata: {}\n\n"

	mockBody := &mockReadCloser{bytes.NewReader([]byte(event))}
	resp := &http.Response{
		Body: mockBody,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
	}

	decoder := NewDecoder(resp)
	if decoder == nil {
		t.Fatal("Decoder should not be nil")
	}
	defer decoder.Close()

	if !decoder.Next() {
		t.Fatalf("Expected event, got error: %v", decoder.Err())
	}

	evt := decoder.Event()
	if evt.Type != "empty" {
		t.Errorf("Expected event type 'empty', got '%s'", evt.Type)
	}
}
