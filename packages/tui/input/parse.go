package input

import (
	"bytes"
	"encoding/base64"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/ansi/parser"
	"github.com/rivo/uniseg"
)

// Flags to control the behavior of the parser.
const (
	// When this flag is set, the driver will treat both Ctrl+Space and Ctrl+@
	// as the same key sequence.
	//
	// Historically, the ANSI specs generate NUL (0x00) on both the Ctrl+Space
	// and Ctrl+@ key sequences. This flag allows the driver to treat both as
	// the same key sequence.
	FlagCtrlAt = 1 << iota

	// When this flag is set, the driver will treat the Tab key and Ctrl+I as
	// the same key sequence.
	//
	// Historically, the ANSI specs generate HT (0x09) on both the Tab key and
	// Ctrl+I. This flag allows the driver to treat both as the same key
	// sequence.
	FlagCtrlI

	// When this flag is set, the driver will treat the Enter key and Ctrl+M as
	// the same key sequence.
	//
	// Historically, the ANSI specs generate CR (0x0D) on both the Enter key
	// and Ctrl+M. This flag allows the driver to treat both as the same key.
	FlagCtrlM

	// When this flag is set, the driver will treat Escape and Ctrl+[ as
	// the same key sequence.
	//
	// Historically, the ANSI specs generate ESC (0x1B) on both the Escape key
	// and Ctrl+[. This flag allows the driver to treat both as the same key
	// sequence.
	FlagCtrlOpenBracket

	// When this flag is set, the driver will send a BS (0x08 byte) character
	// instead of a DEL (0x7F byte) character when the Backspace key is
	// pressed.
	//
	// The VT100 terminal has both a Backspace and a Delete key. The VT220
	// terminal dropped the Backspace key and replaced it with the Delete key.
	// Both terminals send a DEL character when the Delete key is pressed.
	// Modern terminals and PCs later readded the Delete key but used a
	// different key sequence, and the Backspace key was standardized to send a
	// DEL character.
	FlagBackspace

	// When this flag is set, the driver will recognize the Find key instead of
	// treating it as a Home key.
	//
	// The Find key was part of the VT220 keyboard, and is no longer used in
	// modern day PCs.
	FlagFind

	// When this flag is set, the driver will recognize the Select key instead
	// of treating it as a End key.
	//
	// The Symbol key was part of the VT220 keyboard, and is no longer used in
	// modern day PCs.
	FlagSelect

	// When this flag is set, the driver will use Terminfo databases to
	// overwrite the default key sequences.
	FlagTerminfo

	// When this flag is set, the driver will preserve function keys (F13-F63)
	// as symbols.
	//
	// Since these keys are not part of today's standard 20th century keyboard,
	// we treat them as F1-F12 modifier keys i.e. ctrl/shift/alt + Fn combos.
	// Key definitions come from Terminfo, this flag is only useful when
	// FlagTerminfo is not set.
	FlagFKeys

	// When this flag is set, the driver will enable mouse mode on Windows.
	// This is only useful on Windows and has no effect on other platforms.
	FlagMouseMode
)

// Parser is a parser for input escape sequences.
type Parser struct {
	flags int
}

// NewParser returns a new input parser. This is a low-level parser that parses
// escape sequences into human-readable events.
// This differs from [ansi.Parser] and [ansi.DecodeSequence] in which it
// recognizes incorrect sequences that some terminals may send.
//
// For instance, the X10 mouse protocol sends a `CSI M` sequence followed by 3
// bytes. If the parser doesn't recognize the 3 bytes, they might be echoed to
// the terminal output causing a mess.
//
// Another example is how URxvt sends invalid sequences for modified keys using
// invalid CSI final characters like '$'.
//
// Use flags to control the behavior of ambiguous key sequences.
func NewParser(flags int) *Parser {
	return &Parser{flags: flags}
}

// parseSequence finds the first recognized event sequence and returns it along
// with its length.
//
// It will return zero and nil no sequence is recognized or when the buffer is
// empty. If a sequence is not supported, an UnknownEvent is returned.
func (p *Parser) parseSequence(buf []byte) (n int, Event Event) {
	if len(buf) == 0 {
		return 0, nil
	}

	switch b := buf[0]; b {
	case ansi.ESC:
		if len(buf) == 1 {
			// Escape key
			return 1, KeyPressEvent{Code: KeyEscape}
		}

		switch bPrime := buf[1]; bPrime {
		case 'O': // Esc-prefixed SS3
			return p.parseSs3(buf)
		case 'P': // Esc-prefixed DCS
			return p.parseDcs(buf)
		case '[': // Esc-prefixed CSI
			return p.parseCsi(buf)
		case ']': // Esc-prefixed OSC
			return p.parseOsc(buf)
		case '_': // Esc-prefixed APC
			return p.parseApc(buf)
		case '^': // Esc-prefixed PM
			return p.parseStTerminated(ansi.PM, '^', nil)(buf)
		case 'X': // Esc-prefixed SOS
			return p.parseStTerminated(ansi.SOS, 'X', nil)(buf)
		default:
			n, e := p.parseSequence(buf[1:])
			if k, ok := e.(KeyPressEvent); ok {
				k.Text = ""
				k.Mod |= ModAlt
				return n + 1, k
			}

			// Not a key sequence, nor an alt modified key sequence. In that
			// case, just report a single escape key.
			return 1, KeyPressEvent{Code: KeyEscape}
		}
	case ansi.SS3:
		return p.parseSs3(buf)
	case ansi.DCS:
		return p.parseDcs(buf)
	case ansi.CSI:
		return p.parseCsi(buf)
	case ansi.OSC:
		return p.parseOsc(buf)
	case ansi.APC:
		return p.parseApc(buf)
	case ansi.PM:
		return p.parseStTerminated(ansi.PM, '^', nil)(buf)
	case ansi.SOS:
		return p.parseStTerminated(ansi.SOS, 'X', nil)(buf)
	default:
		if b <= ansi.US || b == ansi.DEL || b == ansi.SP {
			return 1, p.parseControl(b)
		} else if b >= ansi.PAD && b <= ansi.APC {
			// C1 control code
			// UTF-8 never starts with a C1 control code
			// Encode these as Ctrl+Alt+<code - 0x40>
			code := rune(b) - 0x40
			return 1, KeyPressEvent{Code: code, Mod: ModCtrl | ModAlt}
		}
		return p.parseUtf8(buf)
	}
}

func (p *Parser) parseCsi(b []byte) (int, Event) {
	if len(b) == 2 && b[0] == ansi.ESC {
		// short cut if this is an alt+[ key
		return 2, KeyPressEvent{Text: string(rune(b[1])), Mod: ModAlt}
	}

	var cmd ansi.Cmd
	var params [parser.MaxParamsSize]ansi.Param
	var paramsLen int

	var i int
	if b[i] == ansi.CSI || b[i] == ansi.ESC {
		i++
	}
	if i < len(b) && b[i-1] == ansi.ESC && b[i] == '[' {
		i++
	}

	// Initial CSI byte
	if i < len(b) && b[i] >= '<' && b[i] <= '?' {
		cmd |= ansi.Cmd(b[i]) << parser.PrefixShift
	}

	// Scan parameter bytes in the range 0x30-0x3F
	var j int
	for j = 0; i < len(b) && paramsLen < len(params) && b[i] >= 0x30 && b[i] <= 0x3F; i, j = i+1, j+1 {
		if b[i] >= '0' && b[i] <= '9' {
			if params[paramsLen] == parser.MissingParam {
				params[paramsLen] = 0
			}
			params[paramsLen] *= 10
			params[paramsLen] += ansi.Param(b[i]) - '0'
		}
		if b[i] == ':' {
			params[paramsLen] |= parser.HasMoreFlag
		}
		if b[i] == ';' || b[i] == ':' {
			paramsLen++
			if paramsLen < len(params) {
				// Don't overflow the params slice
				params[paramsLen] = parser.MissingParam
			}
		}
	}

	if j > 0 && paramsLen < len(params) {
		// has parameters
		paramsLen++
	}

	// Scan intermediate bytes in the range 0x20-0x2F
	var intermed byte
	for ; i < len(b) && b[i] >= 0x20 && b[i] <= 0x2F; i++ {
		intermed = b[i]
	}

	// Set the intermediate byte
	cmd |= ansi.Cmd(intermed) << parser.IntermedShift

	// Scan final byte in the range 0x40-0x7E
	if i >= len(b) {
		// Incomplete sequence
		return 0, nil
	}
	if b[i] < 0x40 || b[i] > 0x7E {
		// Special case for URxvt keys
		// CSI <number> $ is an invalid sequence, but URxvt uses it for
		// shift modified keys.
		if b[i-1] == '$' {
			n, ev := p.parseCsi(append(b[:i-1], '~'))
			if k, ok := ev.(KeyPressEvent); ok {
				k.Mod |= ModShift
				return n, k
			}
		}
		return i, UnknownEvent(b[:i-1])
	}

	// Add the final byte
	cmd |= ansi.Cmd(b[i])
	i++

	pa := ansi.Params(params[:paramsLen])
	switch cmd {
	case 'y' | '?'<<parser.PrefixShift | '$'<<parser.IntermedShift:
		// Report Mode (DECRPM)
		mode, _, ok := pa.Param(0, -1)
		if !ok || mode == -1 {
			break
		}
		value, _, ok := pa.Param(1, -1)
		if !ok || value == -1 {
			break
		}
		return i, ModeReportEvent{Mode: ansi.DECMode(mode), Value: ansi.ModeSetting(value)}
	case 'c' | '?'<<parser.PrefixShift:
		// Primary Device Attributes
		return i, parsePrimaryDevAttrs(pa)
	case 'u' | '?'<<parser.PrefixShift:
		// Kitty keyboard flags
		flags, _, ok := pa.Param(0, -1)
		if !ok || flags == -1 {
			break
		}
		return i, KittyEnhancementsEvent(flags)
	case 'R' | '?'<<parser.PrefixShift:
		// This report may return a third parameter representing the page
		// number, but we don't really need it.
		row, _, ok := pa.Param(0, 1)
		if !ok {
			break
		}
		col, _, ok := pa.Param(1, 1)
		if !ok {
			break
		}
		return i, CursorPositionEvent{Y: row - 1, X: col - 1}
	case 'm' | '<'<<parser.PrefixShift, 'M' | '<'<<parser.PrefixShift:
		// Handle SGR mouse
		if paramsLen >= 3 {
			pa = pa[:3]
			return i, parseSGRMouseEvent(cmd, pa)
		}
	case 'm' | '>'<<parser.PrefixShift:
		// XTerm modifyOtherKeys
		mok, _, ok := pa.Param(0, 0)
		if !ok || mok != 4 {
			break
		}
		val, _, ok := pa.Param(1, -1)
		if !ok || val == -1 {
			break
		}
		return i, ModifyOtherKeysEvent(val) //nolint:gosec
	case 'I':
		return i, FocusEvent{}
	case 'O':
		return i, BlurEvent{}
	case 'R':
		// Cursor position report OR modified F3
		row, _, rok := pa.Param(0, 1)
		col, _, cok := pa.Param(1, 1)
		if paramsLen == 2 && rok && cok {
			m := CursorPositionEvent{Y: row - 1, X: col - 1}
			if row == 1 && col-1 <= int(ModMeta|ModShift|ModAlt|ModCtrl) {
				// XXX: We cannot differentiate between cursor position report and
				// CSI 1 ; <mod> R (which is modified F3) when the cursor is at the
				// row 1. In this case, we report both messages.
				//
				// For a non ambiguous cursor position report, use
				// [ansi.RequestExtendedCursorPosition] (DECXCPR) instead.
				return i, MultiEvent{KeyPressEvent{Code: KeyF3, Mod: KeyMod(col - 1)}, m}
			}

			return i, m
		}

		if paramsLen != 0 {
			break
		}

		// Unmodified key F3 (CSI R)
		fallthrough
	case 'a', 'b', 'c', 'd', 'A', 'B', 'C', 'D', 'E', 'F', 'H', 'P', 'Q', 'S', 'Z':
		var k KeyPressEvent
		switch cmd {
		case 'a', 'b', 'c', 'd':
			k = KeyPressEvent{Code: KeyUp + rune(cmd-'a'), Mod: ModShift}
		case 'A', 'B', 'C', 'D':
			k = KeyPressEvent{Code: KeyUp + rune(cmd-'A')}
		case 'E':
			k = KeyPressEvent{Code: KeyBegin}
		case 'F':
			k = KeyPressEvent{Code: KeyEnd}
		case 'H':
			k = KeyPressEvent{Code: KeyHome}
		case 'P', 'Q', 'R', 'S':
			k = KeyPressEvent{Code: KeyF1 + rune(cmd-'P')}
		case 'Z':
			k = KeyPressEvent{Code: KeyTab, Mod: ModShift}
		}
		id, _, _ := pa.Param(0, 1)
		if id == 0 {
			id = 1
		}
		mod, _, _ := pa.Param(1, 1)
		if mod == 0 {
			mod = 1
		}
		if paramsLen > 1 && id == 1 && mod != -1 {
			// CSI 1 ; <modifiers> A
			k.Mod |= KeyMod(mod - 1)
		}
		// Don't forget to handle Kitty keyboard protocol
		return i, parseKittyKeyboardExt(pa, k)
	case 'M':
		// Handle X10 mouse
		if i+2 >= len(b) {
			// Incomplete sequence
			return 0, nil
		}
		// PERFORMANCE: Do not use append here, as it will allocate a new slice
		// for every mouse event. Instead, pass a sub-slice of the original
		// buffer.
		return i + 3, parseX10MouseEvent(b[i-1 : i+3])
	case 'y' | '$'<<parser.IntermedShift:
		// Report Mode (DECRPM)
		mode, _, ok := pa.Param(0, -1)
		if !ok || mode == -1 {
			break
		}
		val, _, ok := pa.Param(1, -1)
		if !ok || val == -1 {
			break
		}
		return i, ModeReportEvent{Mode: ansi.ANSIMode(mode), Value: ansi.ModeSetting(val)}
	case 'u':
		// Kitty keyboard protocol & CSI u (fixterms)
		if paramsLen == 0 {
			return i, UnknownEvent(b[:i])
		}
		return i, parseKittyKeyboard(pa)
	case '_':
		// Win32 Input Mode
		if paramsLen != 6 {
			return i, UnknownEvent(b[:i])
		}

		vrc, _, _ := pa.Param(5, 0)
		rc := uint16(vrc) //nolint:gosec
		if rc == 0 {
			rc = 1
		}

		vk, _, _ := pa.Param(0, 0)
		sc, _, _ := pa.Param(1, 0)
		uc, _, _ := pa.Param(2, 0)
		kd, _, _ := pa.Param(3, 0)
		cs, _, _ := pa.Param(4, 0)
		event := p.parseWin32InputKeyEvent(
			nil,
			uint16(vk), //nolint:gosec // Vk wVirtualKeyCode
			uint16(sc), //nolint:gosec // Sc wVirtualScanCode
			rune(uc),   // Uc UnicodeChar
			kd == 1,    // Kd bKeyDown
			uint32(cs), //nolint:gosec // Cs dwControlKeyState
			rc,         // Rc wRepeatCount
		)

		if event == nil {
			return i, UnknownEvent(b[:])
		}

		return i, event
	case '@', '^', '~':
		if paramsLen == 0 {
			return i, UnknownEvent(b[:i])
		}

		param, _, _ := pa.Param(0, 0)
		switch cmd {
		case '~':
			switch param {
			case 27:
				// XTerm modifyOtherKeys 2
				if paramsLen != 3 {
					return i, UnknownEvent(b[:i])
				}
				return i, parseXTermModifyOtherKeys(pa)
			case 200:
				// bracketed-paste start
				return i, PasteStartEvent{}
			case 201:
				// bracketed-paste end
				return i, PasteEndEvent{}
			}
		}

		switch param {
		case 1, 2, 3, 4, 5, 6, 7, 8,
			11, 12, 13, 14, 15,
			17, 18, 19, 20, 21,
			23, 24, 25, 26,
			28, 29, 31, 32, 33, 34:
			var k KeyPressEvent
			switch param {
			case 1:
				if p.flags&FlagFind != 0 {
					k = KeyPressEvent{Code: KeyFind}
				} else {
					k = KeyPressEvent{Code: KeyHome}
				}
			case 2:
				k = KeyPressEvent{Code: KeyInsert}
			case 3:
				k = KeyPressEvent{Code: KeyDelete}
			case 4:
				if p.flags&FlagSelect != 0 {
					k = KeyPressEvent{Code: KeySelect}
				} else {
					k = KeyPressEvent{Code: KeyEnd}
				}
			case 5:
				k = KeyPressEvent{Code: KeyPgUp}
			case 6:
				k = KeyPressEvent{Code: KeyPgDown}
			case 7:
				k = KeyPressEvent{Code: KeyHome}
			case 8:
				k = KeyPressEvent{Code: KeyEnd}
			case 11, 12, 13, 14, 15:
				k = KeyPressEvent{Code: KeyF1 + rune(param-11)}
			case 17, 18, 19, 20, 21:
				k = KeyPressEvent{Code: KeyF6 + rune(param-17)}
			case 23, 24, 25, 26:
				k = KeyPressEvent{Code: KeyF11 + rune(param-23)}
			case 28, 29:
				k = KeyPressEvent{Code: KeyF15 + rune(param-28)}
			case 31, 32, 33, 34:
				k = KeyPressEvent{Code: KeyF17 + rune(param-31)}
			}

			// modifiers
			mod, _, _ := pa.Param(1, -1)
			if paramsLen > 1 && mod != -1 {
				k.Mod |= KeyMod(mod - 1)
			}

			// Handle URxvt weird keys
			switch cmd {
			case '~':
				// Don't forget to handle Kitty keyboard protocol
				return i, parseKittyKeyboardExt(pa, k)
			case '^':
				k.Mod |= ModCtrl
			case '@':
				k.Mod |= ModCtrl | ModShift
			}

			return i, k
		}

	case 't':
		param, _, ok := pa.Param(0, 0)
		if !ok {
			break
		}

		var winop WindowOpEvent
		winop.Op = param
		for j := 1; j < paramsLen; j++ {
			val, _, ok := pa.Param(j, 0)
			if ok {
				winop.Args = append(winop.Args, val)
			}
		}

		return i, winop
	}
	return i, UnknownEvent(b[:i])
}

// parseSs3 parses a SS3 sequence.
// See https://vt100.net/docs/vt220-rm/chapter4.html#S4.4.4.2
func (p *Parser) parseSs3(b []byte) (int, Event) {
	if len(b) == 2 && b[0] == ansi.ESC {
		// short cut if this is an alt+O key
		return 2, KeyPressEvent{Code: rune(b[1]), Mod: ModAlt}
	}

	var i int
	if b[i] == ansi.SS3 || b[i] == ansi.ESC {
		i++
	}
	if i < len(b) && b[i-1] == ansi.ESC && b[i] == 'O' {
		i++
	}

	// Scan numbers from 0-9
	var mod int
	for ; i < len(b) && b[i] >= '0' && b[i] <= '9'; i++ {
		mod *= 10
		mod += int(b[i]) - '0'
	}

	// Scan a GL character
	// A GL character is a single byte in the range 0x21-0x7E
	// See https://vt100.net/docs/vt220-rm/chapter2.html#S2.3.2
	if i >= len(b) {
		// Incomplete sequence
		return 0, nil
	}
	if b[i] < 0x21 || b[i] > 0x7E {
		return i, UnknownEvent(b[:i])
	}

	// GL character(s)
	gl := b[i]
	i++

	var k KeyPressEvent
	switch gl {
	case 'a', 'b', 'c', 'd':
		k = KeyPressEvent{Code: KeyUp + rune(gl-'a'), Mod: ModCtrl}
	case 'A', 'B', 'C', 'D':
		k = KeyPressEvent{Code: KeyUp + rune(gl-'A')}
	case 'E':
		k = KeyPressEvent{Code: KeyBegin}
	case 'F':
		k = KeyPressEvent{Code: KeyEnd}
	case 'H':
		k = KeyPressEvent{Code: KeyHome}
	case 'P', 'Q', 'R', 'S':
		k = KeyPressEvent{Code: KeyF1 + rune(gl-'P')}
	case 'M':
		k = KeyPressEvent{Code: KeyKpEnter}
	case 'X':
		k = KeyPressEvent{Code: KeyKpEqual}
	case 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y':
		k = KeyPressEvent{Code: KeyKpMultiply + rune(gl-'j')}
	default:
		return i, UnknownEvent(b[:i])
	}

	// Handle weird SS3 <modifier> Func
	if mod > 0 {
		k.Mod |= KeyMod(mod - 1)
	}

	return i, k
}

func (p *Parser) parseOsc(b []byte) (int, Event) {
	defaultKey := func() KeyPressEvent {
		return KeyPressEvent{Code: rune(b[1]), Mod: ModAlt}
	}
	if len(b) == 2 && b[0] == ansi.ESC {
		// short cut if this is an alt+] key
		return 2, defaultKey()
	}

	var i int
	if b[i] == ansi.OSC || b[i] == ansi.ESC {
		i++
	}
	if i < len(b) && b[i-1] == ansi.ESC && b[i] == ']' {
		i++
	}

	// Parse OSC command
	// An OSC sequence is terminated by a BEL, ESC, or ST character
	var start, end int
	cmd := -1
	for ; i < len(b) && b[i] >= '0' && b[i] <= '9'; i++ {
		if cmd == -1 {
			cmd = 0
		} else {
			cmd *= 10
		}
		cmd += int(b[i]) - '0'
	}

	if i < len(b) && b[i] == ';' {
		// mark the start of the sequence data
		i++
		start = i
	}

	for ; i < len(b); i++ {
		// advance to the end of the sequence
		if slices.Contains([]byte{ansi.BEL, ansi.ESC, ansi.ST, ansi.CAN, ansi.SUB}, b[i]) {
			break
		}
	}

	if i >= len(b) {
		// Incomplete sequence
		return 0, nil
	}

	end = i // end of the sequence data
	i++

	// Check 7-bit ST (string terminator) character
	switch b[i-1] {
	case ansi.CAN, ansi.SUB:
		return i, UnknownEvent(b[:i])
	case ansi.ESC:
		if i >= len(b) || b[i] != '\\' {
			if cmd == -1 || (start == 0 && end == 2) {
				return 2, defaultKey()
			}

			// If we don't have a valid ST terminator, then this is a
			// cancelled sequence and should be ignored.
			return i, UnknownEvent(b[:i])
		}

		i++
	}

	if end <= start {
		return i, UnknownEvent(b[:i])
	}

	// PERFORMANCE: Only allocate the data string if we know we have a handler
	// for the command. This avoids allocations for unknown OSC sequences that
	// can be sent in high frequency by trackpads.
	switch cmd {
	case 10, 11, 12:
		data := string(b[start:end])
		color := ansi.XParseColor(data)
		switch cmd {
		case 10:
			return i, ForegroundColorEvent{color}
		case 11:
			return i, BackgroundColorEvent{color}
		case 12:
			return i, CursorColorEvent{color}
		}
	case 52:
		data := string(b[start:end])
		parts := strings.Split(data, ";")
		if len(parts) == 0 {
			return i, ClipboardEvent{}
		}
		if len(parts) != 2 || len(parts[0]) < 1 {
			break
		}

		b64 := parts[1]
		bts, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			break
		}

		sel := ClipboardSelection(parts[0][0]) //nolint:unconvert
		return i, ClipboardEvent{Selection: sel, Content: string(bts)}
	}

	return i, UnknownEvent(b[:i])
}

// parseStTerminated parses a control sequence that gets terminated by a ST character.
func (p *Parser) parseStTerminated(
	intro8, intro7 byte,
	fn func([]byte) Event,
) func([]byte) (int, Event) {
	defaultKey := func(b []byte) (int, Event) {
		switch intro8 {
		case ansi.SOS:
			return 2, KeyPressEvent{Code: 'x', Mod: ModShift | ModAlt}
		case ansi.PM, ansi.APC:
			return 2, KeyPressEvent{Code: rune(b[1]), Mod: ModAlt}
		}
		return 0, nil
	}
	return func(b []byte) (int, Event) {
		if len(b) == 2 && b[0] == ansi.ESC {
			return defaultKey(b)
		}

		var i int
		if b[i] == intro8 || b[i] == ansi.ESC {
			i++
		}
		if i < len(b) && b[i-1] == ansi.ESC && b[i] == intro7 {
			i++
		}

		// Scan control sequence
		// Most common control sequence is terminated by a ST character
		// ST is a 7-bit string terminator character is (ESC \)
		start := i
		for ; i < len(b); i++ {
			if slices.Contains([]byte{ansi.ESC, ansi.ST, ansi.CAN, ansi.SUB}, b[i]) {
				break
			}
		}

		if i >= len(b) {
			// Incomplete sequence
			return 0, nil
		}

		end := i // end of the sequence data
		i++

		// Check 7-bit ST (string terminator) character
		switch b[i-1] {
		case ansi.CAN, ansi.SUB:
			return i, UnknownEvent(b[:i])
		case ansi.ESC:
			if i >= len(b) || b[i] != '\\' {
				if start == end {
					return defaultKey(b)
				}

				// If we don't have a valid ST terminator, then this is a
				// cancelled sequence and should be ignored.
				return i, UnknownEvent(b[:i])
			}

			i++
		}

		// Call the function to parse the sequence and return the result
		if fn != nil {
			if e := fn(b[start:end]); e != nil {
				return i, e
			}
		}

		return i, UnknownEvent(b[:i])
	}
}

func (p *Parser) parseDcs(b []byte) (int, Event) {
	if len(b) == 2 && b[0] == ansi.ESC {
		// short cut if this is an alt+P key
		return 2, KeyPressEvent{Code: 'p', Mod: ModShift | ModAlt}
	}

	var params [16]ansi.Param
	var paramsLen int
	var cmd ansi.Cmd

	// DCS sequences are introduced by DCS (0x90) or ESC P (0x1b 0x50)
	var i int
	if b[i] == ansi.DCS || b[i] == ansi.ESC {
		i++
	}
	if i < len(b) && b[i-1] == ansi.ESC && b[i] == 'P' {
		i++
	}

	// initial DCS byte
	if i < len(b) && b[i] >= '<' && b[i] <= '?' {
		cmd |= ansi.Cmd(b[i]) << parser.PrefixShift
	}

	// Scan parameter bytes in the range 0x30-0x3F
	var j int
	for j = 0; i < len(b) && paramsLen < len(params) && b[i] >= 0x30 && b[i] <= 0x3F; i, j = i+1, j+1 {
		if b[i] >= '0' && b[i] <= '9' {
			if params[paramsLen] == parser.MissingParam {
				params[paramsLen] = 0
			}
			params[paramsLen] *= 10
			params[paramsLen] += ansi.Param(b[i]) - '0'
		}
		if b[i] == ':' {
			params[paramsLen] |= parser.HasMoreFlag
		}
		if b[i] == ';' || b[i] == ':' {
			paramsLen++
			if paramsLen < len(params) {
				// Don't overflow the params slice
				params[paramsLen] = parser.MissingParam
			}
		}
	}

	if j > 0 && paramsLen < len(params) {
		// has parameters
		paramsLen++
	}

	// Scan intermediate bytes in the range 0x20-0x2F
	var intermed byte
	for j := 0; i < len(b) && b[i] >= 0x20 && b[i] <= 0x2F; i, j = i+1, j+1 {
		intermed = b[i]
	}

	// set intermediate byte
	cmd |= ansi.Cmd(intermed) << parser.IntermedShift

	// Scan final byte in the range 0x40-0x7E
	if i >= len(b) {
		// Incomplete sequence
		return 0, nil
	}
	if b[i] < 0x40 || b[i] > 0x7E {
		return i, UnknownEvent(b[:i])
	}

	// Add the final byte
	cmd |= ansi.Cmd(b[i])
	i++

	start := i // start of the sequence data
	for ; i < len(b); i++ {
		if b[i] == ansi.ST || b[i] == ansi.ESC {
			break
		}
	}

	if i >= len(b) {
		// Incomplete sequence
		return 0, nil
	}

	end := i // end of the sequence data
	i++

	// Check 7-bit ST (string terminator) character
	if i < len(b) && b[i-1] == ansi.ESC && b[i] == '\\' {
		i++
	}

	pa := ansi.Params(params[:paramsLen])
	switch cmd {
	case 'r' | '+'<<parser.IntermedShift:
		// XTGETTCAP responses
		param, _, _ := pa.Param(0, 0)
		switch param {
		case 1: // 1 means valid response, 0 means invalid response
			tc := parseTermcap(b[start:end])
			// XXX: some terminals like KiTTY report invalid responses with
			// their queries i.e. sending a query for "Tc" using "\x1bP+q5463\x1b\\"
			// returns "\x1bP0+r5463\x1b\\".
			// The specs says that invalid responses should be in the form of
			// DCS 0 + r ST "\x1bP0+r\x1b\\"
			// We ignore invalid responses and only send valid ones to the program.
			//
			// See: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
			return i, tc
		}
	case '|' | '>'<<parser.PrefixShift:
		// XTVersion response
		return i, TerminalVersionEvent(b[start:end])
	}

	return i, UnknownEvent(b[:i])
}

func (p *Parser) parseApc(b []byte) (int, Event) {
	if len(b) == 2 && b[0] == ansi.ESC {
		// short cut if this is an alt+_ key
		return 2, KeyPressEvent{Code: rune(b[1]), Mod: ModAlt}
	}

	// APC sequences are introduced by APC (0x9f) or ESC _ (0x1b 0x5f)
	return p.parseStTerminated(ansi.APC, '_', func(b []byte) Event {
		if len(b) == 0 {
			return nil
		}

		switch b[0] {
		case 'G': // Kitty Graphics Protocol
			var g KittyGraphicsEvent
			parts := bytes.Split(b[1:], []byte{';'})
			g.Options.UnmarshalText(parts[0]) //nolint:errcheck,gosec
			if len(parts) > 1 {
				g.Payload = parts[1]
			}
			return g
		}

		return nil
	})(b)
}

func (p *Parser) parseUtf8(b []byte) (int, Event) {
	if len(b) == 0 {
		return 0, nil
	}

	c := b[0]
	if c <= ansi.US || c == ansi.DEL || c == ansi.SP {
		// Control codes get handled by parseControl
		return 1, p.parseControl(c)
	} else if c > ansi.US && c < ansi.DEL {
		// ASCII printable characters
		code := rune(c)
		k := KeyPressEvent{Code: code, Text: string(code)}
		if unicode.IsUpper(code) {
			// Convert upper case letters to lower case + shift modifier
			k.Code = unicode.ToLower(code)
			k.ShiftedCode = code
			k.Mod |= ModShift
		}

		return 1, k
	}

	code, _ := utf8.DecodeRune(b)
	if code == utf8.RuneError {
		return 1, UnknownEvent(b[0])
	}

	cluster, _, _, _ := uniseg.FirstGraphemeCluster(b, -1)
	// PERFORMANCE: Use RuneCount to check for multi-rune graphemes instead of
	// looping over the string representation.
	if utf8.RuneCount(cluster) > 1 {
		code = KeyExtended
	}

	return len(cluster), KeyPressEvent{Code: code, Text: string(cluster)}
}

func (p *Parser) parseControl(b byte) Event {
	switch b {
	case ansi.NUL:
		if p.flags&FlagCtrlAt != 0 {
			return KeyPressEvent{Code: '@', Mod: ModCtrl}
		}
		return KeyPressEvent{Code: KeySpace, Mod: ModCtrl}
	case ansi.BS:
		return KeyPressEvent{Code: 'h', Mod: ModCtrl}
	case ansi.HT:
		if p.flags&FlagCtrlI != 0 {
			return KeyPressEvent{Code: 'i', Mod: ModCtrl}
		}
		return KeyPressEvent{Code: KeyTab}
	case ansi.CR:
		if p.flags&FlagCtrlM != 0 {
			return KeyPressEvent{Code: 'm', Mod: ModCtrl}
		}
		return KeyPressEvent{Code: KeyEnter}
	case ansi.ESC:
		if p.flags&FlagCtrlOpenBracket != 0 {
			return KeyPressEvent{Code: '[', Mod: ModCtrl}
		}
		return KeyPressEvent{Code: KeyEscape}
	case ansi.DEL:
		if p.flags&FlagBackspace != 0 {
			return KeyPressEvent{Code: KeyDelete}
		}
		return KeyPressEvent{Code: KeyBackspace}
	case ansi.SP:
		return KeyPressEvent{Code: KeySpace, Text: " "}
	default:
		if b >= ansi.SOH && b <= ansi.SUB {
			// Use lower case letters for control codes
			code := rune(b + 0x60)
			return KeyPressEvent{Code: code, Mod: ModCtrl}
		} else if b >= ansi.FS && b <= ansi.US {
			code := rune(b + 0x40)
			return KeyPressEvent{Code: code, Mod: ModCtrl}
		}
		return UnknownEvent(b)
	}
}
