package input

// KeyMod represents modifier keys.
type KeyMod int

// Modifier keys.
const (
	ModShift KeyMod = 1 << iota
	ModAlt
	ModCtrl
	ModMeta

	// These modifiers are used with the Kitty protocol.
	// XXX: Meta and Super are swapped in the Kitty protocol,
	// this is to preserve compatibility with XTerm modifiers.

	ModHyper
	ModSuper // Windows/Command keys

	// These are key lock states.

	ModCapsLock
	ModNumLock
	ModScrollLock // Defined in Windows API only
)

// Contains reports whether m contains the given modifiers.
//
// Example:
//
//	m := ModAlt | ModCtrl
//	m.Contains(ModCtrl) // true
//	m.Contains(ModAlt | ModCtrl) // true
//	m.Contains(ModAlt | ModCtrl | ModShift) // false
func (m KeyMod) Contains(mods KeyMod) bool {
	return m&mods == mods
}
