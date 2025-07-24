package input

import (
	"encoding/binary"
	"image/color"
	"reflect"
	"testing"
	"unicode/utf16"

	"github.com/charmbracelet/x/ansi"
	xwindows "github.com/charmbracelet/x/windows"
	"golang.org/x/sys/windows"
)

func TestWindowsInputEvents(t *testing.T) {
	cases := []struct {
		name     string
		events   []xwindows.InputRecord
		expected []Event
		sequence bool // indicates that the input events are ANSI sequence or utf16
	}{
		{
			name: "single key event",
			events: []xwindows.InputRecord{
				encodeKeyEvent(xwindows.KeyEventRecord{
					KeyDown:        true,
					Char:           'a',
					VirtualKeyCode: 'A',
				}),
			},
			expected: []Event{KeyPressEvent{Code: 'a', BaseCode: 'a', Text: "a"}},
		},
		{
			name: "single key event with control key",
			events: []xwindows.InputRecord{
				encodeKeyEvent(xwindows.KeyEventRecord{
					KeyDown:         true,
					Char:            'a',
					VirtualKeyCode:  'A',
					ControlKeyState: xwindows.LEFT_CTRL_PRESSED,
				}),
			},
			expected: []Event{KeyPressEvent{Code: 'a', BaseCode: 'a', Mod: ModCtrl}},
		},
		{
			name: "escape alt key event",
			events: []xwindows.InputRecord{
				encodeKeyEvent(xwindows.KeyEventRecord{
					KeyDown:         true,
					Char:            ansi.ESC,
					VirtualKeyCode:  ansi.ESC,
					ControlKeyState: xwindows.LEFT_ALT_PRESSED,
				}),
			},
			expected: []Event{KeyPressEvent{Code: ansi.ESC, BaseCode: ansi.ESC, Mod: ModAlt}},
		},
		{
			name: "single shifted key event",
			events: []xwindows.InputRecord{
				encodeKeyEvent(xwindows.KeyEventRecord{
					KeyDown:         true,
					Char:            'A',
					VirtualKeyCode:  'A',
					ControlKeyState: xwindows.SHIFT_PRESSED,
				}),
			},
			expected: []Event{KeyPressEvent{Code: 'A', BaseCode: 'a', Text: "A", Mod: ModShift}},
		},
		{
			name:   "utf16 rune",
			events: encodeUtf16Rune('😊'), // smiley emoji '😊'
			expected: []Event{
				KeyPressEvent{Code: '😊', Text: "😊"},
			},
			sequence: true,
		},
		{
			name:     "background color response",
			events:   encodeSequence("\x1b]11;rgb:ff/ff/ff\x07"),
			expected: []Event{BackgroundColorEvent{Color: color.RGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}}},
			sequence: true,
		},
		{
			name:     "st terminated background color response",
			events:   encodeSequence("\x1b]11;rgb:ffff/ffff/ffff\x1b\\"),
			expected: []Event{BackgroundColorEvent{Color: color.RGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}}},
			sequence: true,
		},
		{
			name: "simple mouse event",
			events: []xwindows.InputRecord{
				encodeMouseEvent(xwindows.MouseEventRecord{
					MousePositon: windows.Coord{X: 10, Y: 20},
					ButtonState:  xwindows.FROM_LEFT_1ST_BUTTON_PRESSED,
					EventFlags:   0,
				}),
				encodeMouseEvent(xwindows.MouseEventRecord{
					MousePositon: windows.Coord{X: 10, Y: 20},
					EventFlags:   0,
				}),
			},
			expected: []Event{
				MouseClickEvent{Button: MouseLeft, X: 10, Y: 20},
				MouseReleaseEvent{Button: MouseLeft, X: 10, Y: 20},
			},
		},
		{
			name: "focus event",
			events: []xwindows.InputRecord{
				encodeFocusEvent(xwindows.FocusEventRecord{
					SetFocus: true,
				}),
				encodeFocusEvent(xwindows.FocusEventRecord{
					SetFocus: false,
				}),
			},
			expected: []Event{
				FocusEvent{},
				BlurEvent{},
			},
		},
		{
			name: "window size event",
			events: []xwindows.InputRecord{
				encodeWindowBufferSizeEvent(xwindows.WindowBufferSizeRecord{
					Size: windows.Coord{X: 10, Y: 20},
				}),
			},
			expected: []Event{
				WindowSizeEvent{Width: 10, Height: 20},
			},
		},
	}

	// p is the parser to parse the input events
	var p Parser

	// keep track of the state of the driver to handle ANSI sequences and utf16
	var state win32InputState
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.sequence {
				var Event Event
				for _, ev := range tc.events {
					if ev.EventType != xwindows.KEY_EVENT {
						t.Fatalf("expected key event, got %v", ev.EventType)
					}

					key := ev.KeyEvent()
					Event = p.parseWin32InputKeyEvent(&state, key.VirtualKeyCode, key.VirtualScanCode, key.Char, key.KeyDown, key.ControlKeyState, key.RepeatCount)
				}
				if len(tc.expected) != 1 {
					t.Fatalf("expected 1 event, got %d", len(tc.expected))
				}
				if !reflect.DeepEqual(Event, tc.expected[0]) {
					t.Errorf("expected %v, got %v", tc.expected[0], Event)
				}
			} else {
				if len(tc.events) != len(tc.expected) {
					t.Fatalf("expected %d events, got %d", len(tc.expected), len(tc.events))
				}
				for j, ev := range tc.events {
					Event := p.parseConInputEvent(ev, &state)
					if !reflect.DeepEqual(Event, tc.expected[j]) {
						t.Errorf("expected %#v, got %#v", tc.expected[j], Event)
					}
				}
			}
		})
	}
}

func boolToUint32(b bool) uint32 {
	if b {
		return 1
	}
	return 0
}

func encodeMenuEvent(menu xwindows.MenuEventRecord) xwindows.InputRecord {
	var bts [16]byte
	binary.LittleEndian.PutUint32(bts[0:4], menu.CommandID)
	return xwindows.InputRecord{
		EventType: xwindows.MENU_EVENT,
		Event:     bts,
	}
}

func encodeWindowBufferSizeEvent(size xwindows.WindowBufferSizeRecord) xwindows.InputRecord {
	var bts [16]byte
	binary.LittleEndian.PutUint16(bts[0:2], uint16(size.Size.X))
	binary.LittleEndian.PutUint16(bts[2:4], uint16(size.Size.Y))
	return xwindows.InputRecord{
		EventType: xwindows.WINDOW_BUFFER_SIZE_EVENT,
		Event:     bts,
	}
}

func encodeFocusEvent(focus xwindows.FocusEventRecord) xwindows.InputRecord {
	var bts [16]byte
	if focus.SetFocus {
		bts[0] = 1
	}
	return xwindows.InputRecord{
		EventType: xwindows.FOCUS_EVENT,
		Event:     bts,
	}
}

func encodeMouseEvent(mouse xwindows.MouseEventRecord) xwindows.InputRecord {
	var bts [16]byte
	binary.LittleEndian.PutUint16(bts[0:2], uint16(mouse.MousePositon.X))
	binary.LittleEndian.PutUint16(bts[2:4], uint16(mouse.MousePositon.Y))
	binary.LittleEndian.PutUint32(bts[4:8], mouse.ButtonState)
	binary.LittleEndian.PutUint32(bts[8:12], mouse.ControlKeyState)
	binary.LittleEndian.PutUint32(bts[12:16], mouse.EventFlags)
	return xwindows.InputRecord{
		EventType: xwindows.MOUSE_EVENT,
		Event:     bts,
	}
}

func encodeKeyEvent(key xwindows.KeyEventRecord) xwindows.InputRecord {
	var bts [16]byte
	binary.LittleEndian.PutUint32(bts[0:4], boolToUint32(key.KeyDown))
	binary.LittleEndian.PutUint16(bts[4:6], key.RepeatCount)
	binary.LittleEndian.PutUint16(bts[6:8], key.VirtualKeyCode)
	binary.LittleEndian.PutUint16(bts[8:10], key.VirtualScanCode)
	binary.LittleEndian.PutUint16(bts[10:12], uint16(key.Char))
	binary.LittleEndian.PutUint32(bts[12:16], key.ControlKeyState)
	return xwindows.InputRecord{
		EventType: xwindows.KEY_EVENT,
		Event:     bts,
	}
}

// encodeSequence encodes a string of ANSI escape sequences into a slice of
// Windows input key records.
func encodeSequence(s string) (evs []xwindows.InputRecord) {
	var state byte
	for len(s) > 0 {
		seq, _, n, newState := ansi.DecodeSequence(s, state, nil)
		for i := 0; i < n; i++ {
			evs = append(evs, encodeKeyEvent(xwindows.KeyEventRecord{
				KeyDown: true,
				Char:    rune(seq[i]),
			}))
		}
		state = newState
		s = s[n:]
	}
	return
}

func encodeUtf16Rune(r rune) []xwindows.InputRecord {
	r1, r2 := utf16.EncodeRune(r)
	return encodeUtf16Pair(r1, r2)
}

func encodeUtf16Pair(r1, r2 rune) []xwindows.InputRecord {
	return []xwindows.InputRecord{
		encodeKeyEvent(xwindows.KeyEventRecord{
			KeyDown: true,
			Char:    r1,
		}),
		encodeKeyEvent(xwindows.KeyEventRecord{
			KeyDown: true,
			Char:    r2,
		}),
	}
}
