package decoders

import (
	"bufio"
	"bytes"
	"io"

	"github.com/sst/opencode-sdk-go/packages/ssestream"
)

// UnboundedDecoder is an SSE decoder that uses bufio.Reader instead of bufio.Scanner
// to avoid the 32MB token size limit. This is a workaround for large SSE events until
// the upstream Stainless SDK is fixed.
//
// This decoder handles SSE events of unlimited size by reading line-by-line with
// bufio.Reader.ReadBytes('\n'), which dynamically grows the buffer as needed.
type UnboundedDecoder struct {
	reader *bufio.Reader
	closer io.ReadCloser
	evt    ssestream.Event
	err    error
}

// NewUnboundedDecoder creates a new unbounded SSE decoder with a 1MB initial buffer size
func NewUnboundedDecoder(rc io.ReadCloser) ssestream.Decoder {
	reader := bufio.NewReaderSize(rc, 1024*1024) // 1MB initial buffer
	return &UnboundedDecoder{
		reader: reader,
		closer: rc,
	}
}

// Next reads and decodes the next SSE event from the stream
func (d *UnboundedDecoder) Next() bool {
	if d.err != nil {
		return false
	}

	event := ""
	data := bytes.NewBuffer(nil)

	for {
		line, err := d.reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF && len(line) == 0 {
				return false
			}
			if err != io.EOF {
				d.err = err
				return false
			}
		}

		// Remove trailing newline characters
		line = bytes.TrimRight(line, "\r\n")

		// Empty line indicates end of event
		if len(line) == 0 {
			if data.Len() > 0 || event != "" {
				d.evt = ssestream.Event{
					Type: event,
					Data: data.Bytes(),
				}
				return true
			}
			continue
		}

		// Skip comments (lines starting with ':')
		if line[0] == ':' {
			continue
		}

		// Parse field
		name, value, found := bytes.Cut(line, []byte(":"))
		if !found {
			// Field with no value
			continue
		}

		// Remove leading space from value
		if len(value) > 0 && value[0] == ' ' {
			value = value[1:]
		}

		switch string(name) {
		case "":
			// An empty line in the form ": something" is a comment and should be ignored
			continue
		case "event":
			event = string(value)
		case "data":
			_, d.err = data.Write(value)
			if d.err != nil {
				return false
			}
			_, d.err = data.WriteRune('\n')
			if d.err != nil {
				return false
			}
		}
	}
}

// Event returns the current event
func (d *UnboundedDecoder) Event() ssestream.Event {
	return d.evt
}

// Close closes the underlying reader
func (d *UnboundedDecoder) Close() error {
	return d.closer.Close()
}

// Err returns any error that occurred during decoding
func (d *UnboundedDecoder) Err() error {
	return d.err
}
