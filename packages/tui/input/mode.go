package input

import "github.com/charmbracelet/x/ansi"

// ModeReportEvent is a message that represents a mode report event (DECRPM).
//
// See: https://vt100.net/docs/vt510-rm/DECRPM.html
type ModeReportEvent struct {
	// Mode is the mode number.
	Mode ansi.Mode

	// Value is the mode value.
	Value ansi.ModeSetting
}
