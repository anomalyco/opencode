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
// human‑readable events.
type Reader struct {
	rd         cancelreader.CancelReader
	table      map[string]Key // table is a lookup table for key sequences.
	term       string         // $TERM
	paste      []byte         // bracketed paste buffer; nil when disabled
	buf        [256]byte      // read buffer
	partialSeq []byte         // holds incomplete escape sequences
	keyState   win32InputState
	parser     Parser
	logger     Logger
}

// NewReader returns a new input event reader.
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
func (d *Reader) SetLogger(l Logger) { d.logger = l }

// Read implements io.Reader.
func (d *Reader) Read(p []byte) (int, error) { return d.rd.Read(p) }

// Cancel cancels the underlying reader.
func (d *Reader) Cancel() bool { return d.rd.Cancel() }

// Close closes the underlying reader.
func (d *Reader) Close() error { return d.rd.Close() }

func (d *Reader) readEvents() ([]Event, error) {
	nb, err := d.rd.Read(d.buf[:])
	if err != nil {
		return nil, err
	}

	var events []Event

	// Combine any partial sequence from previous read with new data.
	var buf []byte
	if len(d.partialSeq) > 0 {
		buf = make([]byte, len(d.partialSeq)+nb)
		copy(buf, d.partialSeq)
		copy(buf[len(d.partialSeq):], d.buf[:nb])
		d.partialSeq = nil
	} else {
		buf = d.buf[:nb]
	}

	// Fast path: direct lookup for simple escape sequences.
	if bytes.HasPrefix(buf, []byte{0x1b}) {
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
		consumed, ev := d.parser.parseSequence(buf[i:])
		if d.logger != nil && consumed > 0 {
			d.logger.Printf("input: %q", buf[i:i+consumed])
		}

		// Incomplete sequence – store remainder and exit.
		if consumed == 0 && ev == nil {
			rem := len(buf) - i
			if rem > 0 {
				d.partialSeq = make([]byte, rem)
				copy(d.partialSeq, buf[i:])
			}
			break
		}

		// Handle bracketed paste specially so we don’t emit a paste event for
		// every byte.
		if d.paste != nil {
			if _, ok := ev.(PasteEndEvent); !ok {
				d.paste = append(d.paste, buf[i])
				i++
				continue
			}
		}

		switch ev.(type) {
		case PasteStartEvent:
			d.paste = []byte{}
		case PasteEndEvent:
			var paste []rune
			for len(d.paste) > 0 {
				r, w := utf8.DecodeRune(d.paste)
				if r != utf8.RuneError {
					paste = append(paste, r)
				}
				d.paste = d.paste[w:]
			}
			d.paste = nil
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
		i += consumed
	}

	// Collapse bursts of wheel/motion events into a single event each.
	events = coalesceMouseEvents(events)
	return events, nil
}

// coalesceMouseEvents reduces the volume of MouseWheelEvent and MouseMotionEvent
// objects that arrive in rapid succession by keeping only the most recent
// event in each contiguous run.
func coalesceMouseEvents(in []Event) []Event {
	if len(in) < 2 {
		return in
	}

	out := make([]Event, 0, len(in))
	for _, ev := range in {
		switch ev.(type) {
		case MouseWheelEvent:
			if len(out) > 0 {
				if _, ok := out[len(out)-1].(MouseWheelEvent); ok {
					out[len(out)-1] = ev // replace previous wheel event
					continue
				}
			}
		case MouseMotionEvent:
			if len(out) > 0 {
				if _, ok := out[len(out)-1].(MouseMotionEvent); ok {
					out[len(out)-1] = ev // replace previous motion event
					continue
				}
			}
		}
		out = append(out, ev)
	}
	return out
}
