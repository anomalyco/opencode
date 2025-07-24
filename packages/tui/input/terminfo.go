package input

import (
	"strings"

	"github.com/xo/terminfo"
)

func buildTerminfoKeys(flags int, term string) map[string]Key {
	table := make(map[string]Key)
	ti, _ := terminfo.Load(term)
	if ti == nil {
		return table
	}

	tiTable := defaultTerminfoKeys(flags)

	// Default keys
	for name, seq := range ti.StringCapsShort() {
		if !strings.HasPrefix(name, "k") || len(seq) == 0 {
			continue
		}

		if k, ok := tiTable[name]; ok {
			table[string(seq)] = k
		}
	}

	// Extended keys
	for name, seq := range ti.ExtStringCapsShort() {
		if !strings.HasPrefix(name, "k") || len(seq) == 0 {
			continue
		}

		if k, ok := tiTable[name]; ok {
			table[string(seq)] = k
		}
	}

	return table
}

// This returns a map of terminfo keys to key events. It's a mix of ncurses
// terminfo default and user-defined key capabilities.
// Upper-case caps that are defined in the default terminfo database are
//   - kNXT
//   - kPRV
//   - kHOM
//   - kEND
//   - kDC
//   - kIC
//   - kLFT
//   - kRIT
//
// See https://man7.org/linux/man-pages/man5/terminfo.5.html
// See https://github.com/mirror/ncurses/blob/master/include/Caps-ncurses
func defaultTerminfoKeys(flags int) map[string]Key {
	keys := map[string]Key{
		"kcuu1": {Code: KeyUp},
		"kUP":   {Code: KeyUp, Mod: ModShift},
		"kUP3":  {Code: KeyUp, Mod: ModAlt},
		"kUP4":  {Code: KeyUp, Mod: ModShift | ModAlt},
		"kUP5":  {Code: KeyUp, Mod: ModCtrl},
		"kUP6":  {Code: KeyUp, Mod: ModShift | ModCtrl},
		"kUP7":  {Code: KeyUp, Mod: ModAlt | ModCtrl},
		"kUP8":  {Code: KeyUp, Mod: ModShift | ModAlt | ModCtrl},
		"kcud1": {Code: KeyDown},
		"kDN":   {Code: KeyDown, Mod: ModShift},
		"kDN3":  {Code: KeyDown, Mod: ModAlt},
		"kDN4":  {Code: KeyDown, Mod: ModShift | ModAlt},
		"kDN5":  {Code: KeyDown, Mod: ModCtrl},
		"kDN7":  {Code: KeyDown, Mod: ModAlt | ModCtrl},
		"kDN6":  {Code: KeyDown, Mod: ModShift | ModCtrl},
		"kDN8":  {Code: KeyDown, Mod: ModShift | ModAlt | ModCtrl},
		"kcub1": {Code: KeyLeft},
		"kLFT":  {Code: KeyLeft, Mod: ModShift},
		"kLFT3": {Code: KeyLeft, Mod: ModAlt},
		"kLFT4": {Code: KeyLeft, Mod: ModShift | ModAlt},
		"kLFT5": {Code: KeyLeft, Mod: ModCtrl},
		"kLFT6": {Code: KeyLeft, Mod: ModShift | ModCtrl},
		"kLFT7": {Code: KeyLeft, Mod: ModAlt | ModCtrl},
		"kLFT8": {Code: KeyLeft, Mod: ModShift | ModAlt | ModCtrl},
		"kcuf1": {Code: KeyRight},
		"kRIT":  {Code: KeyRight, Mod: ModShift},
		"kRIT3": {Code: KeyRight, Mod: ModAlt},
		"kRIT4": {Code: KeyRight, Mod: ModShift | ModAlt},
		"kRIT5": {Code: KeyRight, Mod: ModCtrl},
		"kRIT6": {Code: KeyRight, Mod: ModShift | ModCtrl},
		"kRIT7": {Code: KeyRight, Mod: ModAlt | ModCtrl},
		"kRIT8": {Code: KeyRight, Mod: ModShift | ModAlt | ModCtrl},
		"kich1": {Code: KeyInsert},
		"kIC":   {Code: KeyInsert, Mod: ModShift},
		"kIC3":  {Code: KeyInsert, Mod: ModAlt},
		"kIC4":  {Code: KeyInsert, Mod: ModShift | ModAlt},
		"kIC5":  {Code: KeyInsert, Mod: ModCtrl},
		"kIC6":  {Code: KeyInsert, Mod: ModShift | ModCtrl},
		"kIC7":  {Code: KeyInsert, Mod: ModAlt | ModCtrl},
		"kIC8":  {Code: KeyInsert, Mod: ModShift | ModAlt | ModCtrl},
		"kdch1": {Code: KeyDelete},
		"kDC":   {Code: KeyDelete, Mod: ModShift},
		"kDC3":  {Code: KeyDelete, Mod: ModAlt},
		"kDC4":  {Code: KeyDelete, Mod: ModShift | ModAlt},
		"kDC5":  {Code: KeyDelete, Mod: ModCtrl},
		"kDC6":  {Code: KeyDelete, Mod: ModShift | ModCtrl},
		"kDC7":  {Code: KeyDelete, Mod: ModAlt | ModCtrl},
		"kDC8":  {Code: KeyDelete, Mod: ModShift | ModAlt | ModCtrl},
		"khome": {Code: KeyHome},
		"kHOM":  {Code: KeyHome, Mod: ModShift},
		"kHOM3": {Code: KeyHome, Mod: ModAlt},
		"kHOM4": {Code: KeyHome, Mod: ModShift | ModAlt},
		"kHOM5": {Code: KeyHome, Mod: ModCtrl},
		"kHOM6": {Code: KeyHome, Mod: ModShift | ModCtrl},
		"kHOM7": {Code: KeyHome, Mod: ModAlt | ModCtrl},
		"kHOM8": {Code: KeyHome, Mod: ModShift | ModAlt | ModCtrl},
		"kend":  {Code: KeyEnd},
		"kEND":  {Code: KeyEnd, Mod: ModShift},
		"kEND3": {Code: KeyEnd, Mod: ModAlt},
		"kEND4": {Code: KeyEnd, Mod: ModShift | ModAlt},
		"kEND5": {Code: KeyEnd, Mod: ModCtrl},
		"kEND6": {Code: KeyEnd, Mod: ModShift | ModCtrl},
		"kEND7": {Code: KeyEnd, Mod: ModAlt | ModCtrl},
		"kEND8": {Code: KeyEnd, Mod: ModShift | ModAlt | ModCtrl},
		"kpp":   {Code: KeyPgUp},
		"kprv":  {Code: KeyPgUp},
		"kPRV":  {Code: KeyPgUp, Mod: ModShift},
		"kPRV3": {Code: KeyPgUp, Mod: ModAlt},
		"kPRV4": {Code: KeyPgUp, Mod: ModShift | ModAlt},
		"kPRV5": {Code: KeyPgUp, Mod: ModCtrl},
		"kPRV6": {Code: KeyPgUp, Mod: ModShift | ModCtrl},
		"kPRV7": {Code: KeyPgUp, Mod: ModAlt | ModCtrl},
		"kPRV8": {Code: KeyPgUp, Mod: ModShift | ModAlt | ModCtrl},
		"knp":   {Code: KeyPgDown},
		"knxt":  {Code: KeyPgDown},
		"kNXT":  {Code: KeyPgDown, Mod: ModShift},
		"kNXT3": {Code: KeyPgDown, Mod: ModAlt},
		"kNXT4": {Code: KeyPgDown, Mod: ModShift | ModAlt},
		"kNXT5": {Code: KeyPgDown, Mod: ModCtrl},
		"kNXT6": {Code: KeyPgDown, Mod: ModShift | ModCtrl},
		"kNXT7": {Code: KeyPgDown, Mod: ModAlt | ModCtrl},
		"kNXT8": {Code: KeyPgDown, Mod: ModShift | ModAlt | ModCtrl},

		"kbs":  {Code: KeyBackspace},
		"kcbt": {Code: KeyTab, Mod: ModShift},

		// Function keys
		// This only includes the first 12 function keys. The rest are treated
		// as modifiers of the first 12.
		// Take a look at XTerm modifyFunctionKeys
		//
		// XXX: To use unambiguous function keys, use fixterms or kitty clipboard.
		//
		// See https://invisible-island.net/xterm/manpage/xterm.html#VT100-Widget-Resources:modifyFunctionKeys
		// See https://invisible-island.net/xterm/terminfo.html

		"kf1":  {Code: KeyF1},
		"kf2":  {Code: KeyF2},
		"kf3":  {Code: KeyF3},
		"kf4":  {Code: KeyF4},
		"kf5":  {Code: KeyF5},
		"kf6":  {Code: KeyF6},
		"kf7":  {Code: KeyF7},
		"kf8":  {Code: KeyF8},
		"kf9":  {Code: KeyF9},
		"kf10": {Code: KeyF10},
		"kf11": {Code: KeyF11},
		"kf12": {Code: KeyF12},
		"kf13": {Code: KeyF1, Mod: ModShift},
		"kf14": {Code: KeyF2, Mod: ModShift},
		"kf15": {Code: KeyF3, Mod: ModShift},
		"kf16": {Code: KeyF4, Mod: ModShift},
		"kf17": {Code: KeyF5, Mod: ModShift},
		"kf18": {Code: KeyF6, Mod: ModShift},
		"kf19": {Code: KeyF7, Mod: ModShift},
		"kf20": {Code: KeyF8, Mod: ModShift},
		"kf21": {Code: KeyF9, Mod: ModShift},
		"kf22": {Code: KeyF10, Mod: ModShift},
		"kf23": {Code: KeyF11, Mod: ModShift},
		"kf24": {Code: KeyF12, Mod: ModShift},
		"kf25": {Code: KeyF1, Mod: ModCtrl},
		"kf26": {Code: KeyF2, Mod: ModCtrl},
		"kf27": {Code: KeyF3, Mod: ModCtrl},
		"kf28": {Code: KeyF4, Mod: ModCtrl},
		"kf29": {Code: KeyF5, Mod: ModCtrl},
		"kf30": {Code: KeyF6, Mod: ModCtrl},
		"kf31": {Code: KeyF7, Mod: ModCtrl},
		"kf32": {Code: KeyF8, Mod: ModCtrl},
		"kf33": {Code: KeyF9, Mod: ModCtrl},
		"kf34": {Code: KeyF10, Mod: ModCtrl},
		"kf35": {Code: KeyF11, Mod: ModCtrl},
		"kf36": {Code: KeyF12, Mod: ModCtrl},
		"kf37": {Code: KeyF1, Mod: ModShift | ModCtrl},
		"kf38": {Code: KeyF2, Mod: ModShift | ModCtrl},
		"kf39": {Code: KeyF3, Mod: ModShift | ModCtrl},
		"kf40": {Code: KeyF4, Mod: ModShift | ModCtrl},
		"kf41": {Code: KeyF5, Mod: ModShift | ModCtrl},
		"kf42": {Code: KeyF6, Mod: ModShift | ModCtrl},
		"kf43": {Code: KeyF7, Mod: ModShift | ModCtrl},
		"kf44": {Code: KeyF8, Mod: ModShift | ModCtrl},
		"kf45": {Code: KeyF9, Mod: ModShift | ModCtrl},
		"kf46": {Code: KeyF10, Mod: ModShift | ModCtrl},
		"kf47": {Code: KeyF11, Mod: ModShift | ModCtrl},
		"kf48": {Code: KeyF12, Mod: ModShift | ModCtrl},
		"kf49": {Code: KeyF1, Mod: ModAlt},
		"kf50": {Code: KeyF2, Mod: ModAlt},
		"kf51": {Code: KeyF3, Mod: ModAlt},
		"kf52": {Code: KeyF4, Mod: ModAlt},
		"kf53": {Code: KeyF5, Mod: ModAlt},
		"kf54": {Code: KeyF6, Mod: ModAlt},
		"kf55": {Code: KeyF7, Mod: ModAlt},
		"kf56": {Code: KeyF8, Mod: ModAlt},
		"kf57": {Code: KeyF9, Mod: ModAlt},
		"kf58": {Code: KeyF10, Mod: ModAlt},
		"kf59": {Code: KeyF11, Mod: ModAlt},
		"kf60": {Code: KeyF12, Mod: ModAlt},
		"kf61": {Code: KeyF1, Mod: ModShift | ModAlt},
		"kf62": {Code: KeyF2, Mod: ModShift | ModAlt},
		"kf63": {Code: KeyF3, Mod: ModShift | ModAlt},
	}

	// Preserve F keys from F13 to F63 instead of using them for F-keys
	// modifiers.
	if flags&FlagFKeys != 0 {
		keys["kf13"] = Key{Code: KeyF13}
		keys["kf14"] = Key{Code: KeyF14}
		keys["kf15"] = Key{Code: KeyF15}
		keys["kf16"] = Key{Code: KeyF16}
		keys["kf17"] = Key{Code: KeyF17}
		keys["kf18"] = Key{Code: KeyF18}
		keys["kf19"] = Key{Code: KeyF19}
		keys["kf20"] = Key{Code: KeyF20}
		keys["kf21"] = Key{Code: KeyF21}
		keys["kf22"] = Key{Code: KeyF22}
		keys["kf23"] = Key{Code: KeyF23}
		keys["kf24"] = Key{Code: KeyF24}
		keys["kf25"] = Key{Code: KeyF25}
		keys["kf26"] = Key{Code: KeyF26}
		keys["kf27"] = Key{Code: KeyF27}
		keys["kf28"] = Key{Code: KeyF28}
		keys["kf29"] = Key{Code: KeyF29}
		keys["kf30"] = Key{Code: KeyF30}
		keys["kf31"] = Key{Code: KeyF31}
		keys["kf32"] = Key{Code: KeyF32}
		keys["kf33"] = Key{Code: KeyF33}
		keys["kf34"] = Key{Code: KeyF34}
		keys["kf35"] = Key{Code: KeyF35}
		keys["kf36"] = Key{Code: KeyF36}
		keys["kf37"] = Key{Code: KeyF37}
		keys["kf38"] = Key{Code: KeyF38}
		keys["kf39"] = Key{Code: KeyF39}
		keys["kf40"] = Key{Code: KeyF40}
		keys["kf41"] = Key{Code: KeyF41}
		keys["kf42"] = Key{Code: KeyF42}
		keys["kf43"] = Key{Code: KeyF43}
		keys["kf44"] = Key{Code: KeyF44}
		keys["kf45"] = Key{Code: KeyF45}
		keys["kf46"] = Key{Code: KeyF46}
		keys["kf47"] = Key{Code: KeyF47}
		keys["kf48"] = Key{Code: KeyF48}
		keys["kf49"] = Key{Code: KeyF49}
		keys["kf50"] = Key{Code: KeyF50}
		keys["kf51"] = Key{Code: KeyF51}
		keys["kf52"] = Key{Code: KeyF52}
		keys["kf53"] = Key{Code: KeyF53}
		keys["kf54"] = Key{Code: KeyF54}
		keys["kf55"] = Key{Code: KeyF55}
		keys["kf56"] = Key{Code: KeyF56}
		keys["kf57"] = Key{Code: KeyF57}
		keys["kf58"] = Key{Code: KeyF58}
		keys["kf59"] = Key{Code: KeyF59}
		keys["kf60"] = Key{Code: KeyF60}
		keys["kf61"] = Key{Code: KeyF61}
		keys["kf62"] = Key{Code: KeyF62}
		keys["kf63"] = Key{Code: KeyF63}
	}

	return keys
}
