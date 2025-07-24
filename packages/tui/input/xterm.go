package input

import (
	"github.com/charmbracelet/x/ansi"
)

func parseXTermModifyOtherKeys(params ansi.Params) Event {
	// XTerm modify other keys starts with ESC [ 27 ; <modifier> ; <code> ~
	xmod, _, _ := params.Param(1, 1)
	xrune, _, _ := params.Param(2, 1)
	mod := KeyMod(xmod - 1)
	r := rune(xrune)

	switch r {
	case ansi.BS:
		return KeyPressEvent{Mod: mod, Code: KeyBackspace}
	case ansi.HT:
		return KeyPressEvent{Mod: mod, Code: KeyTab}
	case ansi.CR:
		return KeyPressEvent{Mod: mod, Code: KeyEnter}
	case ansi.ESC:
		return KeyPressEvent{Mod: mod, Code: KeyEscape}
	case ansi.DEL:
		return KeyPressEvent{Mod: mod, Code: KeyBackspace}
	}

	// CSI 27 ; <modifier> ; <code> ~ keys defined in XTerm modifyOtherKeys
	k := KeyPressEvent{Code: r, Mod: mod}
	if k.Mod <= ModShift {
		k.Text = string(r)
	}

	return k
}

// TerminalVersionEvent is a message that represents the terminal version.
type TerminalVersionEvent string

// ModifyOtherKeysEvent represents a modifyOtherKeys event.
//
//	0: disable
//	1: enable mode 1
//	2: enable mode 2
//
// See: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Functions-using-CSI-_-ordered-by-the-final-character_s_
// See: https://invisible-island.net/xterm/manpage/xterm.html#VT100-Widget-Resources:modifyOtherKeys
type ModifyOtherKeysEvent uint8
