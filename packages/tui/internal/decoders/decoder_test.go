package decoders

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestUnboundedDecoder_SmallEvent(t *testing.T) {
	data := "event: test\ndata: hello world\n\n"
	rc := io.NopCloser(strings.NewReader(data))
	decoder := NewUnboundedDecoder(rc)

	if !decoder.Next() {
		t.Fatal("Expected Next() to return true")
	}

	evt := decoder.Event()
	if evt.Type != "test" {
		t.Errorf("Expected event type 'test', got '%s'", evt.Type)
	}
	if string(evt.Data) != "hello world\n" {
		t.Errorf("Expected data 'hello world\\n', got '%s'", string(evt.Data))
	}

	if decoder.Next() {
		t.Error("Expected Next() to return false at end of stream")
	}

	if err := decoder.Err(); err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestUnboundedDecoder_LargeEvent(t *testing.T) {
	// Create a large event (50MB)
	size := 50 * 1024 * 1024
	largeData := strings.Repeat("x", size)

	var buf bytes.Buffer
	buf.WriteString("event: large\n")
	buf.WriteString("data: ")
	buf.WriteString(largeData)
	buf.WriteString("\n\n")

	rc := io.NopCloser(&buf)
	decoder := NewUnboundedDecoder(rc)

	if !decoder.Next() {
		t.Fatal("Expected Next() to return true")
	}

	evt := decoder.Event()
	if evt.Type != "large" {
		t.Errorf("Expected event type 'large', got '%s'", evt.Type)
	}

	expectedData := largeData + "\n"
	if string(evt.Data) != expectedData {
		t.Errorf("Data size mismatch: expected %d, got %d", len(expectedData), len(evt.Data))
	}

	if decoder.Next() {
		t.Error("Expected Next() to return false at end of stream")
	}

	if err := decoder.Err(); err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestUnboundedDecoder_MultipleEvents(t *testing.T) {
	data := "event: first\ndata: data1\n\nevent: second\ndata: data2\n\n"
	rc := io.NopCloser(strings.NewReader(data))
	decoder := NewUnboundedDecoder(rc)

	// First event
	if !decoder.Next() {
		t.Fatal("Expected Next() to return true for first event")
	}
	evt := decoder.Event()
	if evt.Type != "first" {
		t.Errorf("Expected event type 'first', got '%s'", evt.Type)
	}
	if string(evt.Data) != "data1\n" {
		t.Errorf("Expected data 'data1\\n', got '%s'", string(evt.Data))
	}

	// Second event
	if !decoder.Next() {
		t.Fatal("Expected Next() to return true for second event")
	}
	evt = decoder.Event()
	if evt.Type != "second" {
		t.Errorf("Expected event type 'second', got '%s'", evt.Type)
	}
	if string(evt.Data) != "data2\n" {
		t.Errorf("Expected data 'data2\\n', got '%s'", string(evt.Data))
	}

	// No more events
	if decoder.Next() {
		t.Error("Expected Next() to return false at end of stream")
	}

	if err := decoder.Err(); err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestUnboundedDecoder_MultilineData(t *testing.T) {
	data := "event: multiline\ndata: line1\ndata: line2\ndata: line3\n\n"
	rc := io.NopCloser(strings.NewReader(data))
	decoder := NewUnboundedDecoder(rc)

	if !decoder.Next() {
		t.Fatal("Expected Next() to return true")
	}

	evt := decoder.Event()
	if evt.Type != "multiline" {
		t.Errorf("Expected event type 'multiline', got '%s'", evt.Type)
	}

	expectedData := "line1\nline2\nline3\n"
	if string(evt.Data) != expectedData {
		t.Errorf("Expected data '%s', got '%s'", expectedData, string(evt.Data))
	}
}

func TestUnboundedDecoder_Comments(t *testing.T) {
	data := ": this is a comment\nevent: test\n: another comment\ndata: hello\n\n"
	rc := io.NopCloser(strings.NewReader(data))
	decoder := NewUnboundedDecoder(rc)

	if !decoder.Next() {
		t.Fatal("Expected Next() to return true")
	}

	evt := decoder.Event()
	if evt.Type != "test" {
		t.Errorf("Expected event type 'test', got '%s'", evt.Type)
	}
	if string(evt.Data) != "hello\n" {
		t.Errorf("Expected data 'hello\\n', got '%s'", string(evt.Data))
	}
}

func TestUnboundedDecoder_NoEventType(t *testing.T) {
	data := "data: hello\n\n"
	rc := io.NopCloser(strings.NewReader(data))
	decoder := NewUnboundedDecoder(rc)

	if !decoder.Next() {
		t.Fatal("Expected Next() to return true")
	}

	evt := decoder.Event()
	if evt.Type != "" {
		t.Errorf("Expected empty event type, got '%s'", evt.Type)
	}
	if string(evt.Data) != "hello\n" {
		t.Errorf("Expected data 'hello\\n', got '%s'", string(evt.Data))
	}
}

func BenchmarkUnboundedDecoder_LargeEvent(b *testing.B) {
	// Create a 10MB event for benchmarking
	size := 10 * 1024 * 1024
	largeData := strings.Repeat("x", size)

	var buf bytes.Buffer
	buf.WriteString("event: bench\n")
	buf.WriteString("data: ")
	buf.WriteString(largeData)
	buf.WriteString("\n\n")

	data := buf.Bytes()

	b.ResetTimer()
	b.SetBytes(int64(len(data)))

	for i := 0; i < b.N; i++ {
		rc := io.NopCloser(bytes.NewReader(data))
		decoder := NewUnboundedDecoder(rc)

		if !decoder.Next() {
			b.Fatal("Expected Next() to return true")
		}

		_ = decoder.Event()
	}
}
