package input

import (
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/ansi/kitty"
)

// KittyGraphicsEvent represents a Kitty Graphics response event.
//
// See https://sw.kovidgoyal.net/kitty/graphics-protocol/
type KittyGraphicsEvent struct {
	Options kitty.Options
	Payload []byte
}

// KittyEnhancementsEvent represents a Kitty enhancements event.
type KittyEnhancementsEvent int

// Kitty keyboard enhancement constants.
// See https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
const (
	KittyDisambiguateEscapeCodes KittyEnhancementsEvent = 1 << iota
	KittyReportEventTypes
	KittyReportAlternateKeys
	KittyReportAllKeysAsEscapeCodes
	KittyReportAssociatedText
)

// Contains reports whether m contains the given enhancements.
func (e KittyEnhancementsEvent) Contains(enhancements KittyEnhancementsEvent) bool {
	return e&enhancements == enhancements
}

// Kitty Clipboard Control Sequences.
var kittyKeyMap = map[int]Key{
	ansi.BS:  {Code: KeyBackspace},
	ansi.HT:  {Code: KeyTab},
	ansi.CR:  {Code: KeyEnter},
	ansi.ESC: {Code: KeyEscape},
	ansi.DEL: {Code: KeyBackspace},

	57344: {Code: KeyEscape},
	57345: {Code: KeyEnter},
	57346: {Code: KeyTab},
	57347: {Code: KeyBackspace},
	57348: {Code: KeyInsert},
	57349: {Code: KeyDelete},
	57350: {Code: KeyLeft},
	57351: {Code: KeyRight},
	57352: {Code: KeyUp},
	57353: {Code: KeyDown},
	57354: {Code: KeyPgUp},
	57355: {Code: KeyPgDown},
	57356: {Code: KeyHome},
	57357: {Code: KeyEnd},
	57358: {Code: KeyCapsLock},
	57359: {Code: KeyScrollLock},
	57360: {Code: KeyNumLock},
	57361: {Code: KeyPrintScreen},
	57362: {Code: KeyPause},
	57363: {Code: KeyMenu},
	57364: {Code: KeyF1},
	57365: {Code: KeyF2},
	57366: {Code: KeyF3},
	57367: {Code: KeyF4},
	57368: {Code: KeyF5},
	57369: {Code: KeyF6},
	57370: {Code: KeyF7},
	57371: {Code: KeyF8},
	57372: {Code: KeyF9},
	57373: {Code: KeyF10},
	57374: {Code: KeyF11},
	57375: {Code: KeyF12},
	57376: {Code: KeyF13},
	57377: {Code: KeyF14},
	57378: {Code: KeyF15},
	57379: {Code: KeyF16},
	57380: {Code: KeyF17},
	57381: {Code: KeyF18},
	57382: {Code: KeyF19},
	57383: {Code: KeyF20},
	57384: {Code: KeyF21},
	57385: {Code: KeyF22},
	57386: {Code: KeyF23},
	57387: {Code: KeyF24},
	57388: {Code: KeyF25},
	57389: {Code: KeyF26},
	57390: {Code: KeyF27},
	57391: {Code: KeyF28},
	57392: {Code: KeyF29},
	57393: {Code: KeyF30},
	57394: {Code: KeyF31},
	57395: {Code: KeyF32},
	57396: {Code: KeyF33},
	57397: {Code: KeyF34},
	57398: {Code: KeyF35},
	57399: {Code: KeyKp0},
	57400: {Code: KeyKp1},
	57401: {Code: KeyKp2},
	57402: {Code: KeyKp3},
	57403: {Code: KeyKp4},
	57404: {Code: KeyKp5},
	57405: {Code: KeyKp6},
	57406: {Code: KeyKp7},
	57407: {Code: KeyKp8},
	57408: {Code: KeyKp9},
	57409: {Code: KeyKpDecimal},
	57410: {Code: KeyKpDivide},
	57411: {Code: KeyKpMultiply},
	57412: {Code: KeyKpMinus},
	57413: {Code: KeyKpPlus},
	57414: {Code: KeyKpEnter},
	57415: {Code: KeyKpEqual},
	57416: {Code: KeyKpSep},
	57417: {Code: KeyKpLeft},
	57418: {Code: KeyKpRight},
	57419: {Code: KeyKpUp},
	57420: {Code: KeyKpDown},
	57421: {Code: KeyKpPgUp},
	57422: {Code: KeyKpPgDown},
	57423: {Code: KeyKpHome},
	57424: {Code: KeyKpEnd},
	57425: {Code: KeyKpInsert},
	57426: {Code: KeyKpDelete},
	57427: {Code: KeyKpBegin},
	57428: {Code: KeyMediaPlay},
	57429: {Code: KeyMediaPause},
	57430: {Code: KeyMediaPlayPause},
	57431: {Code: KeyMediaReverse},
	57432: {Code: KeyMediaStop},
	57433: {Code: KeyMediaFastForward},
	57434: {Code: KeyMediaRewind},
	57435: {Code: KeyMediaNext},
	57436: {Code: KeyMediaPrev},
	57437: {Code: KeyMediaRecord},
	57438: {Code: KeyLowerVol},
	57439: {Code: KeyRaiseVol},
	57440: {Code: KeyMute},
	57441: {Code: KeyLeftShift},
	57442: {Code: KeyLeftCtrl},
	57443: {Code: KeyLeftAlt},
	57444: {Code: KeyLeftSuper},
	57445: {Code: KeyLeftHyper},
	57446: {Code: KeyLeftMeta},
	57447: {Code: KeyRightShift},
	57448: {Code: KeyRightCtrl},
	57449: {Code: KeyRightAlt},
	57450: {Code: KeyRightSuper},
	57451: {Code: KeyRightHyper},
	57452: {Code: KeyRightMeta},
	57453: {Code: KeyIsoLevel3Shift},
	57454: {Code: KeyIsoLevel5Shift},
}

func init() {
	// These are some faulty C0 mappings some terminals such as WezTerm have
	// and doesn't follow the specs.
	kittyKeyMap[ansi.NUL] = Key{Code: KeySpace, Mod: ModCtrl}
	for i := ansi.SOH; i <= ansi.SUB; i++ {
		if _, ok := kittyKeyMap[i]; !ok {
			kittyKeyMap[i] = Key{Code: rune(i + 0x60), Mod: ModCtrl}
		}
	}
	for i := ansi.FS; i <= ansi.US; i++ {
		if _, ok := kittyKeyMap[i]; !ok {
			kittyKeyMap[i] = Key{Code: rune(i + 0x40), Mod: ModCtrl}
		}
	}
}

const (
	kittyShift = 1 << iota
	kittyAlt
	kittyCtrl
	kittySuper
	kittyHyper
	kittyMeta
	kittyCapsLock
	kittyNumLock
)

func fromKittyMod(mod int) KeyMod {
	var m KeyMod
	if mod&kittyShift != 0 {
		m |= ModShift
	}
	if mod&kittyAlt != 0 {
		m |= ModAlt
	}
	if mod&kittyCtrl != 0 {
		m |= ModCtrl
	}
	if mod&kittySuper != 0 {
		m |= ModSuper
	}
	if mod&kittyHyper != 0 {
		m |= ModHyper
	}
	if mod&kittyMeta != 0 {
		m |= ModMeta
	}
	if mod&kittyCapsLock != 0 {
		m |= ModCapsLock
	}
	if mod&kittyNumLock != 0 {
		m |= ModNumLock
	}
	return m
}

// parseKittyKeyboard parses a Kitty Keyboard Protocol sequence.
//
// In `CSI u`, this is parsed as:
//
//	CSI codepoint ; modifiers u
//	codepoint: ASCII Dec value
//
// The Kitty Keyboard Protocol extends this with optional components that can be
// enabled progressively. The full sequence is parsed as:
//
//	CSI unicode-key-code:alternate-key-codes ; modifiers:event-type ; text-as-codepoints u
//
// See https://sw.kovidgoyal.net/kitty/keyboard-protocol/
func parseKittyKeyboard(params ansi.Params) (Event Event) {
	var isRelease bool
	var key Key

	// The index of parameters separated by semicolons ';'. Sub parameters are
	// separated by colons ':'.
	var paramIdx int
	var sudIdx int // The sub parameter index
	for _, p := range params {
		// Kitty Keyboard Protocol has 3 optional components.
		switch paramIdx {
		case 0:
			switch sudIdx {
			case 0:
				var foundKey bool
				code := p.Param(1) // CSI u has a default value of 1
				key, foundKey = kittyKeyMap[code]
				if !foundKey {
					r := rune(code)
					if !utf8.ValidRune(r) {
						r = utf8.RuneError
					}

					key.Code = r
				}

			case 2:
				// shifted key + base key
				if b := rune(p.Param(1)); unicode.IsPrint(b) {
					// XXX: When alternate key reporting is enabled, the protocol
					// can return 3 things, the unicode codepoint of the key,
					// the shifted codepoint of the key, and the standard
					// PC-101 key layout codepoint.
					// This is useful to create an unambiguous mapping of keys
					// when using a different language layout.
					key.BaseCode = b
				}
				fallthrough

			case 1:
				// shifted key
				if s := rune(p.Param(1)); unicode.IsPrint(s) {
					// XXX: We swap keys here because we want the shifted key
					// to be the Rune that is returned by the event.
					// For example, shift+a should produce "A" not "a".
					// In such a case, we set AltRune to the original key "a"
					// and Rune to "A".
					key.ShiftedCode = s
				}
			}
		case 1:
			switch sudIdx {
			case 0:
				mod := p.Param(1)
				if mod > 1 {
					key.Mod = fromKittyMod(mod - 1)
					if key.Mod > ModShift {
						// XXX: We need to clear the text if we have a modifier key
						// other than a [ModShift] key.
						key.Text = ""
					}
				}

			case 1:
				switch p.Param(1) {
				case 2:
					key.IsRepeat = true
				case 3:
					isRelease = true
				}
			case 2:
			}
		case 2:
			if code := p.Param(0); code != 0 {
				key.Text += string(rune(code))
			}
		}

		sudIdx++
		if !p.HasMore() {
			paramIdx++
			sudIdx = 0
		}
	}

	//nolint:nestif
	if len(key.Text) == 0 && unicode.IsPrint(key.Code) &&
		(key.Mod <= ModShift || key.Mod == ModCapsLock || key.Mod == ModShift|ModCapsLock) {
		if key.Mod == 0 {
			key.Text = string(key.Code)
		} else {
			desiredCase := unicode.ToLower
			if key.Mod.Contains(ModShift) || key.Mod.Contains(ModCapsLock) {
				desiredCase = unicode.ToUpper
			}
			if key.ShiftedCode != 0 {
				key.Text = string(key.ShiftedCode)
			} else {
				key.Text = string(desiredCase(key.Code))
			}
		}
	}

	if isRelease {
		return KeyReleaseEvent(key)
	}

	return KeyPressEvent(key)
}

// parseKittyKeyboardExt parses a Kitty Keyboard Protocol sequence extensions
// for non CSI u sequences. This includes things like CSI A, SS3 A and others,
// and CSI ~.
func parseKittyKeyboardExt(params ansi.Params, k KeyPressEvent) Event {
	// Handle Kitty keyboard protocol
	if len(params) > 2 && // We have at least 3 parameters
		params[0].Param(1) == 1 && // The first parameter is 1 (defaults to 1)
		params[1].HasMore() { // The second parameter is a subparameter (separated by a ":")
		switch params[2].Param(1) { // The third parameter is the event type (defaults to 1)
		case 2:
			k.IsRepeat = true
		case 3:
			return KeyReleaseEvent(k)
		}
	}
	return k
}
