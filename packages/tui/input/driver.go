//nolint:unused,revive,nolintlint
package input

import (
	"bytes"
	"io"
	"unicode/utf8"

	"github.com/muesli/cancelreader"
)

// Logger is a simple logger interface.
type Logger interface {
	Printf(format string, v ...any)
}

// win32InputState is a state machine for parsing key events from the Windows
// Console API into escape sequences and utf8 runes, and keeps track of the last
// control key state to determine modifier key changes. It also keeps track of
// the last mouse button state and window size changes to determine which mouse
// buttons were released and to prevent multiple size events from firing.
type win32InputState struct {
	ansiBuf                    [256]byte
	ansiIdx                    int
	utf16Buf                   [2]rune
	utf16Half                  bool
	lastCks                    uint32 // the last control key state for the previous event
	lastMouseBtns              uint32 // the last mouse button state for the previous event
	lastWinsizeX, lastWinsizeY int16  // the last window size for the previous event to prevent multiple size events from firing
}

// Reader represents an input event reader. It reads input events and parses
// escape sequences from the terminal input buffer and translates them into
// human-readable events.
type Reader struct {
	rd    cancelreader.CancelReader
	table map[string]Key // table is a lookup table for key sequences.

	term string // term is the terminal name $TERM.

	// paste is the bracketed paste mode buffer.
	// When nil, bracketed paste mode is disabled.
	paste []byte

	buf [256]byte // do we need a larger buffer?

	// partialSeq holds incomplete escape sequences that need more data
	partialSeq []byte

	// keyState keeps track of the current Windows Console API key events state.
	// It is used to decode ANSI escape sequences and utf16 sequences.
	keyState win32InputState

	parser Parser
	logger Logger
}

// NewReader returns a new input event reader. The reader reads input events
// from the terminal and parses escape sequences into human-readable events. It
// supports reading Terminfo databases. See [Parser] for more information.
//
// Example:
//
//	r, _ := input.NewReader(os.Stdin, os.Getenv("TERM"), 0)
//	defer r.Close()
//	events, _ := r.ReadEvents()
//	for _, ev := range events {
//	  log.Printf("%v", ev)
//	}
func NewReader(r io.Reader, termType string, flags int) (*Reader, error) {
	d := new(Reader)
	cr, err := newCancelreader(r, flags)
	if err != nil {
		return nil, err
	}

	d.rd = cr
	d.table = buildKeysTable(flags, termType)
	d.term = termType
	d.parser.flags = flags
	return d, nil
}

// SetLogger sets a logger for the reader.
func (d *Reader) SetLogger(l Logger) {
	d.logger = l
}

// Read implements [io.Reader].
func (d *Reader) Read(p []byte) (int, error) {
	return d.rd.Read(p) //nolint:wrapcheck
}

// Cancel cancels the underlying reader.
func (d *Reader) Cancel() bool {
	return d.rd.Cancel()
}

// Close closes the underlying reader.
func (d *Reader) Close() error {
	return d.rd.Close() //nolint:wrapcheck
}

func (d *Reader) readEvents() ([]Event, error) {
	nb, err := d.rd.Read(d.buf[:])
	if err != nil {
		return nil, err //nolint:wrapcheck
	}

	var events []Event

	// Combine any partial sequence from previous read with new data
	var buf []byte
	if len(d.partialSeq) > 0 {
		buf = make([]byte, len(d.partialSeq)+nb)
		copy(buf, d.partialSeq)
		copy(buf[len(d.partialSeq):], d.buf[:nb])
		d.partialSeq = nil // clear the partial sequence
	} else {
		buf = d.buf[:nb]
	}

	// Lookup table first
	if bytes.HasPrefix(buf, []byte{'\x1b'}) {
		if k, ok := d.table[string(buf)]; ok {
			if d.logger != nil {
				d.logger.Printf("input: %q", buf)
			}
			events = append(events, KeyPressEvent(k))
			return events, nil
		}
	}

	var i int
	for i < len(buf) {
		nb, ev := d.parser.parseSequence(buf[i:])
		if d.logger != nil && nb > 0 {
			d.logger.Printf("input: %q", buf[i:i+nb])
		}

		// Handle incomplete sequences - when parseSequence returns (0, nil)
		// it means we need more data to complete the sequence
		if nb == 0 && ev == nil {
			// Store the remaining data for the next read
			remaining := len(buf) - i
			if remaining > 0 {
				d.partialSeq = make([]byte, remaining)
				copy(d.partialSeq, buf[i:])
			}
			break
		}

		// Handle bracketed-paste
		if d.paste != nil {
			if _, ok := ev.(PasteEndEvent); !ok {
				d.paste = append(d.paste, buf[i])
				i++
				continue
			}
		}

		switch ev.(type) {
		// case UnknownEvent:
		// 	// If the sequence is not recognized by the parser, try looking it up.
		// 	if k, ok := d.table[string(buf[i:i+nb])]; ok {
		// 		ev = KeyPressEvent(k)
		// 	}
		case PasteStartEvent:
			d.paste = []byte{}
		case PasteEndEvent:
			// Decode the captured data into runes.
			var paste []rune
			for len(d.paste) > 0 {
				r, w := utf8.DecodeRune(d.paste)
				if r != utf8.RuneError {
					paste = append(paste, r)
				}
				d.paste = d.paste[w:]
			}
			d.paste = nil // reset the buffer
			events = append(events, PasteEvent(paste))
		case nil:
			i++
			continue
		}

		if mevs, ok := ev.(MultiEvent); ok {
			events = append(events, []Event(mevs)...)
		} else {
			events = append(events, ev)
		}
		i += nb
	}

	return events, nil
}
