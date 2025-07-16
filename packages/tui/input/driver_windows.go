//go:build windows
// +build windows

package input

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
	xwindows "github.com/charmbracelet/x/windows"
	"github.com/muesli/cancelreader"
	"golang.org/x/sys/windows"
)

// ReadEvents reads input events from the terminal.
//
// It reads the events available in the input buffer and returns them.
func (d *Reader) ReadEvents() ([]Event, error) {
	events, err := d.handleConInput()
	if errors.Is(err, errNotConInputReader) {
		return d.readEvents()
	}
	return events, err
}

var errNotConInputReader = fmt.Errorf("handleConInput: not a conInputReader")

func (d *Reader) handleConInput() ([]Event, error) {
	cc, ok := d.rd.(*conInputReader)
	if !ok {
		return nil, errNotConInputReader
	}

	var (
		events []xwindows.InputRecord
		err    error
	)
	for {
		// Peek up to 256 events, this is to allow for sequences events reported as
		// key events.
		events, err = peekNConsoleInputs(cc.conin, 256)
		if cc.isCanceled() {
			return nil, cancelreader.ErrCanceled
		}
		if err != nil {
			return nil, fmt.Errorf("peek coninput events: %w", err)
		}
		if len(events) > 0 {
			break
		}

		// Sleep for a bit to avoid busy waiting.
		time.Sleep(10 * time.Millisecond)
	}

	events, err = readNConsoleInputs(cc.conin, uint32(len(events)))
	if cc.isCanceled() {
		return nil, cancelreader.ErrCanceled
	}
	if err != nil {
		return nil, fmt.Errorf("read coninput events: %w", err)
	}

	var evs []Event
	for _, event := range events {
		if e := d.parser.parseConInputEvent(event, &d.keyState); e != nil {
			if multi, ok := e.(MultiEvent); ok {
				evs = append(evs, multi...)
			} else {
				evs = append(evs, e)
			}
		}
	}

	return evs, nil
}

func (p *Parser) parseConInputEvent(event xwindows.InputRecord, keyState *win32InputState) Event {
	switch event.EventType {
	case xwindows.KEY_EVENT:
		kevent := event.KeyEvent()
		return p.parseWin32InputKeyEvent(keyState, kevent.VirtualKeyCode, kevent.VirtualScanCode,
			kevent.Char, kevent.KeyDown, kevent.ControlKeyState, kevent.RepeatCount)

	case xwindows.WINDOW_BUFFER_SIZE_EVENT:
		wevent := event.WindowBufferSizeEvent()
		if wevent.Size.X != keyState.lastWinsizeX || wevent.Size.Y != keyState.lastWinsizeY {
			keyState.lastWinsizeX, keyState.lastWinsizeY = wevent.Size.X, wevent.Size.Y
			return WindowSizeEvent{
				Width:  int(wevent.Size.X),
				Height: int(wevent.Size.Y),
			}
		}
	case xwindows.MOUSE_EVENT:
		mevent := event.MouseEvent()
		Event := mouseEvent(keyState.lastMouseBtns, mevent)
		keyState.lastMouseBtns = mevent.ButtonState
		return Event
	case xwindows.FOCUS_EVENT:
		fevent := event.FocusEvent()
		if fevent.SetFocus {
			return FocusEvent{}
		}
		return BlurEvent{}
	case xwindows.MENU_EVENT:
		// ignore
	}
	return nil
}

func mouseEventButton(p, s uint32) (MouseButton, bool) {
	var isRelease bool
	button := MouseNone
	btn := p ^ s
	if btn&s == 0 {
		isRelease = true
	}

	if btn == 0 {
		switch {
		case s&xwindows.FROM_LEFT_1ST_BUTTON_PRESSED > 0:
			button = MouseLeft
		case s&xwindows.FROM_LEFT_2ND_BUTTON_PRESSED > 0:
			button = MouseMiddle
		case s&xwindows.RIGHTMOST_BUTTON_PRESSED > 0:
			button = MouseRight
		case s&xwindows.FROM_LEFT_3RD_BUTTON_PRESSED > 0:
			button = MouseBackward
		case s&xwindows.FROM_LEFT_4TH_BUTTON_PRESSED > 0:
			button = MouseForward
		}
		return button, isRelease
	}

	switch btn {
	case xwindows.FROM_LEFT_1ST_BUTTON_PRESSED: // left button
		button = MouseLeft
	case xwindows.RIGHTMOST_BUTTON_PRESSED: // right button
		button = MouseRight
	case xwindows.FROM_LEFT_2ND_BUTTON_PRESSED: // middle button
		button = MouseMiddle
	case xwindows.FROM_LEFT_3RD_BUTTON_PRESSED: // unknown (possibly mouse backward)
		button = MouseBackward
	case xwindows.FROM_LEFT_4TH_BUTTON_PRESSED: // unknown (possibly mouse forward)
		button = MouseForward
	}

	return button, isRelease
}

func mouseEvent(p uint32, e xwindows.MouseEventRecord) (ev Event) {
	var mod KeyMod
	var isRelease bool
	if e.ControlKeyState&(xwindows.LEFT_ALT_PRESSED|xwindows.RIGHT_ALT_PRESSED) != 0 {
		mod |= ModAlt
	}
	if e.ControlKeyState&(xwindows.LEFT_CTRL_PRESSED|xwindows.RIGHT_CTRL_PRESSED) != 0 {
		mod |= ModCtrl
	}
	if e.ControlKeyState&(xwindows.SHIFT_PRESSED) != 0 {
		mod |= ModShift
	}

	m := Mouse{
		X:   int(e.MousePositon.X),
		Y:   int(e.MousePositon.Y),
		Mod: mod,
	}

	wheelDirection := int16(highWord(e.ButtonState)) //nolint:gosec
	switch e.EventFlags {
	case 0, xwindows.DOUBLE_CLICK:
		m.Button, isRelease = mouseEventButton(p, e.ButtonState)
	case xwindows.MOUSE_WHEELED:
		if wheelDirection > 0 {
			m.Button = MouseWheelUp
		} else {
			m.Button = MouseWheelDown
		}
	case xwindows.MOUSE_HWHEELED:
		if wheelDirection > 0 {
			m.Button = MouseWheelRight
		} else {
			m.Button = MouseWheelLeft
		}
	case xwindows.MOUSE_MOVED:
		m.Button, _ = mouseEventButton(p, e.ButtonState)
		return MouseMotionEvent(m)
	}

	if isWheel(m.Button) {
		return MouseWheelEvent(m)
	} else if isRelease {
		return MouseReleaseEvent(m)
	}

	return MouseClickEvent(m)
}

func highWord(data uint32) uint16 {
	return uint16((data & 0xFFFF0000) >> 16) //nolint:gosec
}

func readNConsoleInputs(console windows.Handle, maxEvents uint32) ([]xwindows.InputRecord, error) {
	if maxEvents == 0 {
		return nil, fmt.Errorf("maxEvents cannot be zero")
	}

	records := make([]xwindows.InputRecord, maxEvents)
	n, err := readConsoleInput(console, records)
	return records[:n], err
}

func readConsoleInput(console windows.Handle, inputRecords []xwindows.InputRecord) (uint32, error) {
	if len(inputRecords) == 0 {
		return 0, fmt.Errorf("size of input record buffer cannot be zero")
	}

	var read uint32

	err := xwindows.ReadConsoleInput(console, &inputRecords[0], uint32(len(inputRecords)), &read) //nolint:gosec

	return read, err //nolint:wrapcheck
}

func peekConsoleInput(console windows.Handle, inputRecords []xwindows.InputRecord) (uint32, error) {
	if len(inputRecords) == 0 {
		return 0, fmt.Errorf("size of input record buffer cannot be zero")
	}

	var read uint32

	err := xwindows.PeekConsoleInput(console, &inputRecords[0], uint32(len(inputRecords)), &read) //nolint:gosec

	return read, err //nolint:wrapcheck
}

func peekNConsoleInputs(console windows.Handle, maxEvents uint32) ([]xwindows.InputRecord, error) {
	if maxEvents == 0 {
		return nil, fmt.Errorf("maxEvents cannot be zero")
	}

	records := make([]xwindows.InputRecord, maxEvents)
	n, err := peekConsoleInput(console, records)
	return records[:n], err
}

// parseWin32InputKeyEvent parses a single key event from either the Windows
// Console API or win32-input-mode events. When state is nil, it means this is
// an event from win32-input-mode. Otherwise, it's a key event from the Windows
// Console API and needs a state to decode ANSI escape sequences and utf16
// runes.
func (p *Parser) parseWin32InputKeyEvent(state *win32InputState, vkc uint16, _ uint16, r rune, keyDown bool, cks uint32, repeatCount uint16) (event Event) {
	defer func() {
		// Respect the repeat count.
		if repeatCount > 1 {
			var multi MultiEvent
			for i := 0; i < int(repeatCount); i++ {
				multi = append(multi, event)
			}
			event = multi
		}
	}()
	if state != nil {
		defer func() {
			state.lastCks = cks
		}()
	}

	var utf8Buf [utf8.UTFMax]byte
	var key Key
	if state != nil && state.utf16Half {
		state.utf16Half = false
		state.utf16Buf[1] = r
		codepoint := utf16.DecodeRune(state.utf16Buf[0], state.utf16Buf[1])
		rw := utf8.EncodeRune(utf8Buf[:], codepoint)
		r, _ = utf8.DecodeRune(utf8Buf[:rw])
		key.Code = r
		key.Text = string(r)
		key.Mod = translateControlKeyState(cks)
		key = ensureKeyCase(key, cks)
		if keyDown {
			return KeyPressEvent(key)
		}
		return KeyReleaseEvent(key)
	}

	var baseCode rune
	switch {
	case vkc == 0:
		// Zero means this event is either an escape code or a unicode
		// codepoint.
		if state != nil && state.ansiIdx == 0 && r != ansi.ESC {
			// This is a unicode codepoint.
			baseCode = r
			break
		}

		if state != nil {
			// Collect ANSI escape code.
			state.ansiBuf[state.ansiIdx] = byte(r)
			state.ansiIdx++
			if state.ansiIdx <= 2 {
				// We haven't received enough bytes to determine if this is an
				// ANSI escape code.
				return nil
			}
			if r == ansi.ESC {
				// We're expecting a closing String Terminator [ansi.ST].
				return nil
			}

			n, event := p.parseSequence(state.ansiBuf[:state.ansiIdx])
			if n == 0 {
				return nil
			}
			if _, ok := event.(UnknownEvent); ok {
				return nil
			}

			state.ansiIdx = 0
			return event
		}
	case vkc == xwindows.VK_BACK:
		baseCode = KeyBackspace
	case vkc == xwindows.VK_TAB:
		baseCode = KeyTab
	case vkc == xwindows.VK_RETURN:
		baseCode = KeyEnter
	case vkc == xwindows.VK_SHIFT:
		//nolint:nestif
		if cks&xwindows.SHIFT_PRESSED != 0 {
			if cks&xwindows.ENHANCED_KEY != 0 {
				baseCode = KeyRightShift
			} else {
				baseCode = KeyLeftShift
			}
		} else if state != nil {
			if state.lastCks&xwindows.SHIFT_PRESSED != 0 {
				if state.lastCks&xwindows.ENHANCED_KEY != 0 {
					baseCode = KeyRightShift
				} else {
					baseCode = KeyLeftShift
				}
			}
		}
	case vkc == xwindows.VK_CONTROL:
		if cks&xwindows.LEFT_CTRL_PRESSED != 0 {
			baseCode = KeyLeftCtrl
		} else if cks&xwindows.RIGHT_CTRL_PRESSED != 0 {
			baseCode = KeyRightCtrl
		} else if state != nil {
			if state.lastCks&xwindows.LEFT_CTRL_PRESSED != 0 {
				baseCode = KeyLeftCtrl
			} else if state.lastCks&xwindows.RIGHT_CTRL_PRESSED != 0 {
				baseCode = KeyRightCtrl
			}
		}
	case vkc == xwindows.VK_MENU:
		if cks&xwindows.LEFT_ALT_PRESSED != 0 {
			baseCode = KeyLeftAlt
		} else if cks&xwindows.RIGHT_ALT_PRESSED != 0 {
			baseCode = KeyRightAlt
		} else if state != nil {
			if state.lastCks&xwindows.LEFT_ALT_PRESSED != 0 {
				baseCode = KeyLeftAlt
			} else if state.lastCks&xwindows.RIGHT_ALT_PRESSED != 0 {
				baseCode = KeyRightAlt
			}
		}
	case vkc == xwindows.VK_PAUSE:
		baseCode = KeyPause
	case vkc == xwindows.VK_CAPITAL:
		baseCode = KeyCapsLock
	case vkc == xwindows.VK_ESCAPE:
		baseCode = KeyEscape
	case vkc == xwindows.VK_SPACE:
		baseCode = KeySpace
	case vkc == xwindows.VK_PRIOR:
		baseCode = KeyPgUp
	case vkc == xwindows.VK_NEXT:
		baseCode = KeyPgDown
	case vkc == xwindows.VK_END:
		baseCode = KeyEnd
	case vkc == xwindows.VK_HOME:
		baseCode = KeyHome
	case vkc == xwindows.VK_LEFT:
		baseCode = KeyLeft
	case vkc == xwindows.VK_UP:
		baseCode = KeyUp
	case vkc == xwindows.VK_RIGHT:
		baseCode = KeyRight
	case vkc == xwindows.VK_DOWN:
		baseCode = KeyDown
	case vkc == xwindows.VK_SELECT:
		baseCode = KeySelect
	case vkc == xwindows.VK_SNAPSHOT:
		baseCode = KeyPrintScreen
	case vkc == xwindows.VK_INSERT:
		baseCode = KeyInsert
	case vkc == xwindows.VK_DELETE:
		baseCode = KeyDelete
	case vkc >= '0' && vkc <= '9':
		baseCode = rune(vkc)
	case vkc >= 'A' && vkc <= 'Z':
		// Convert to lowercase.
		baseCode = rune(vkc) + 32
	case vkc == xwindows.VK_LWIN:
		baseCode = KeyLeftSuper
	case vkc == xwindows.VK_RWIN:
		baseCode = KeyRightSuper
	case vkc == xwindows.VK_APPS:
		baseCode = KeyMenu
	case vkc >= xwindows.VK_NUMPAD0 && vkc <= xwindows.VK_NUMPAD9:
		baseCode = rune(vkc-xwindows.VK_NUMPAD0) + KeyKp0
	case vkc == xwindows.VK_MULTIPLY:
		baseCode = KeyKpMultiply
	case vkc == xwindows.VK_ADD:
		baseCode = KeyKpPlus
	case vkc == xwindows.VK_SEPARATOR:
		baseCode = KeyKpComma
	case vkc == xwindows.VK_SUBTRACT:
		baseCode = KeyKpMinus
	case vkc == xwindows.VK_DECIMAL:
		baseCode = KeyKpDecimal
	case vkc == xwindows.VK_DIVIDE:
		baseCode = KeyKpDivide
	case vkc >= xwindows.VK_F1 && vkc <= xwindows.VK_F24:
		baseCode = rune(vkc-xwindows.VK_F1) + KeyF1
	case vkc == xwindows.VK_NUMLOCK:
		baseCode = KeyNumLock
	case vkc == xwindows.VK_SCROLL:
		baseCode = KeyScrollLock
	case vkc == xwindows.VK_LSHIFT:
		baseCode = KeyLeftShift
	case vkc == xwindows.VK_RSHIFT:
		baseCode = KeyRightShift
	case vkc == xwindows.VK_LCONTROL:
		baseCode = KeyLeftCtrl
	case vkc == xwindows.VK_RCONTROL:
		baseCode = KeyRightCtrl
	case vkc == xwindows.VK_LMENU:
		baseCode = KeyLeftAlt
	case vkc == xwindows.VK_RMENU:
		baseCode = KeyRightAlt
	case vkc == xwindows.VK_VOLUME_MUTE:
		baseCode = KeyMute
	case vkc == xwindows.VK_VOLUME_DOWN:
		baseCode = KeyLowerVol
	case vkc == xwindows.VK_VOLUME_UP:
		baseCode = KeyRaiseVol
	case vkc == xwindows.VK_MEDIA_NEXT_TRACK:
		baseCode = KeyMediaNext
	case vkc == xwindows.VK_MEDIA_PREV_TRACK:
		baseCode = KeyMediaPrev
	case vkc == xwindows.VK_MEDIA_STOP:
		baseCode = KeyMediaStop
	case vkc == xwindows.VK_MEDIA_PLAY_PAUSE:
		baseCode = KeyMediaPlayPause
	case vkc == xwindows.VK_OEM_1:
		baseCode = ';'
	case vkc == xwindows.VK_OEM_PLUS:
		baseCode = '+'
	case vkc == xwindows.VK_OEM_COMMA:
		baseCode = ','
	case vkc == xwindows.VK_OEM_MINUS:
		baseCode = '-'
	case vkc == xwindows.VK_OEM_PERIOD:
		baseCode = '.'
	case vkc == xwindows.VK_OEM_2:
		baseCode = '/'
	case vkc == xwindows.VK_OEM_3:
		baseCode = '`'
	case vkc == xwindows.VK_OEM_4:
		baseCode = '['
	case vkc == xwindows.VK_OEM_5:
		baseCode = '\\'
	case vkc == xwindows.VK_OEM_6:
		baseCode = ']'
	case vkc == xwindows.VK_OEM_7:
		baseCode = '\''
	}

	if utf16.IsSurrogate(r) {
		if state != nil {
			state.utf16Buf[0] = r
			state.utf16Half = true
		}
		return nil
	}

	// AltGr is left ctrl + right alt. On non-US keyboards, this is used to type
	// special characters and produce printable events.
	// XXX: Should this be a KeyMod?
	altGr := cks&(xwindows.LEFT_CTRL_PRESSED|xwindows.RIGHT_ALT_PRESSED) == xwindows.LEFT_CTRL_PRESSED|xwindows.RIGHT_ALT_PRESSED

	var text string
	keyCode := baseCode
	if !unicode.IsControl(r) {
		rw := utf8.EncodeRune(utf8Buf[:], r)
		keyCode, _ = utf8.DecodeRune(utf8Buf[:rw])
		if unicode.IsPrint(keyCode) && (cks == 0 ||
			cks == xwindows.SHIFT_PRESSED ||
			cks == xwindows.CAPSLOCK_ON ||
			altGr) {
			// If the control key state is 0, shift is pressed, or caps lock
			// then the key event is a printable event i.e. [text] is not empty.
			text = string(keyCode)
		}
	}

	key.Code = keyCode
	key.Text = text
	key.Mod = translateControlKeyState(cks)
	key.BaseCode = baseCode
	key = ensureKeyCase(key, cks)
	if keyDown {
		return KeyPressEvent(key)
	}

	return KeyReleaseEvent(key)
}

// ensureKeyCase ensures that the key's text is in the correct case based on the
// control key state.
func ensureKeyCase(key Key, cks uint32) Key {
	if len(key.Text) == 0 {
		return key
	}

	hasShift := cks&xwindows.SHIFT_PRESSED != 0
	hasCaps := cks&xwindows.CAPSLOCK_ON != 0
	if hasShift || hasCaps {
		if unicode.IsLower(key.Code) {
			key.ShiftedCode = unicode.ToUpper(key.Code)
			key.Text = string(key.ShiftedCode)
		}
	} else {
		if unicode.IsUpper(key.Code) {
			key.ShiftedCode = unicode.ToLower(key.Code)
			key.Text = string(key.ShiftedCode)
		}
	}

	return key
}

// translateControlKeyState translates the control key state from the Windows
// Console API into a Mod bitmask.
func translateControlKeyState(cks uint32) (m KeyMod) {
	if cks&xwindows.LEFT_CTRL_PRESSED != 0 || cks&xwindows.RIGHT_CTRL_PRESSED != 0 {
		m |= ModCtrl
	}
	if cks&xwindows.LEFT_ALT_PRESSED != 0 || cks&xwindows.RIGHT_ALT_PRESSED != 0 {
		m |= ModAlt
	}
	if cks&xwindows.SHIFT_PRESSED != 0 {
		m |= ModShift
	}
	if cks&xwindows.CAPSLOCK_ON != 0 {
		m |= ModCapsLock
	}
	if cks&xwindows.NUMLOCK_ON != 0 {
		m |= ModNumLock
	}
	if cks&xwindows.SCROLLLOCK_ON != 0 {
		m |= ModScrollLock
	}
	return
}

//nolint:unused
func keyEventString(vkc, sc uint16, r rune, keyDown bool, cks uint32, repeatCount uint16) string {
	var s strings.Builder
	s.WriteString("vkc: ")
	s.WriteString(fmt.Sprintf("%d, 0x%02x", vkc, vkc))
	s.WriteString(", sc: ")
	s.WriteString(fmt.Sprintf("%d, 0x%02x", sc, sc))
	s.WriteString(", r: ")
	s.WriteString(fmt.Sprintf("%q", r))
	s.WriteString(", down: ")
	s.WriteString(fmt.Sprintf("%v", keyDown))
	s.WriteString(", cks: [")
	if cks&xwindows.LEFT_ALT_PRESSED != 0 {
		s.WriteString("left alt, ")
	}
	if cks&xwindows.RIGHT_ALT_PRESSED != 0 {
		s.WriteString("right alt, ")
	}
	if cks&xwindows.LEFT_CTRL_PRESSED != 0 {
		s.WriteString("left ctrl, ")
	}
	if cks&xwindows.RIGHT_CTRL_PRESSED != 0 {
		s.WriteString("right ctrl, ")
	}
	if cks&xwindows.SHIFT_PRESSED != 0 {
		s.WriteString("shift, ")
	}
	if cks&xwindows.CAPSLOCK_ON != 0 {
		s.WriteString("caps lock, ")
	}
	if cks&xwindows.NUMLOCK_ON != 0 {
		s.WriteString("num lock, ")
	}
	if cks&xwindows.SCROLLLOCK_ON != 0 {
		s.WriteString("scroll lock, ")
	}
	if cks&xwindows.ENHANCED_KEY != 0 {
		s.WriteString("enhanced key, ")
	}
	s.WriteString("], repeat count: ")
	s.WriteString(fmt.Sprintf("%d", repeatCount))
	return s.String()
}
