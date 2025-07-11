package input

import (
	"fmt"

	"github.com/charmbracelet/x/ansi"
)

// MouseButton represents the button that was pressed during a mouse message.
type MouseButton = ansi.MouseButton

// Mouse event buttons
//
// This is based on X11 mouse button codes.
//
//	1 = left button
//	2 = middle button (pressing the scroll wheel)
//	3 = right button
//	4 = turn scroll wheel up
//	5 = turn scroll wheel down
//	6 = push scroll wheel left
//	7 = push scroll wheel right
//	8 = 4th button (aka browser backward button)
//	9 = 5th button (aka browser forward button)
//	10
//	11
//
// Other buttons are not supported.
const (
	MouseNone       = ansi.MouseNone
	MouseLeft       = ansi.MouseLeft
	MouseMiddle     = ansi.MouseMiddle
	MouseRight      = ansi.MouseRight
	MouseWheelUp    = ansi.MouseWheelUp
	MouseWheelDown  = ansi.MouseWheelDown
	MouseWheelLeft  = ansi.MouseWheelLeft
	MouseWheelRight = ansi.MouseWheelRight
	MouseBackward   = ansi.MouseBackward
	MouseForward    = ansi.MouseForward
	MouseButton10   = ansi.MouseButton10
	MouseButton11   = ansi.MouseButton11
)

// MouseEvent represents a mouse message. This is a generic mouse message that
// can represent any kind of mouse event.
type MouseEvent interface {
	fmt.Stringer

	// Mouse returns the underlying mouse event.
	Mouse() Mouse
}

// Mouse represents a Mouse message. Use [MouseEvent] to represent all mouse
// messages.
//
// The X and Y coordinates are zero-based, with (0,0) being the upper left
// corner of the terminal.
//
//	// Catch all mouse events
//	switch Event := Event.(type) {
//	case MouseEvent:
//	    m := Event.Mouse()
//	    fmt.Println("Mouse event:", m.X, m.Y, m)
//	}
//
//	// Only catch mouse click events
//	switch Event := Event.(type) {
//	case MouseClickEvent:
//	    fmt.Println("Mouse click event:", Event.X, Event.Y, Event)
//	}
type Mouse struct {
	X, Y   int
	Button MouseButton
	Mod    KeyMod
}

// String returns a string representation of the mouse message.
func (m Mouse) String() (s string) {
	if m.Mod.Contains(ModCtrl) {
		s += "ctrl+"
	}
	if m.Mod.Contains(ModAlt) {
		s += "alt+"
	}
	if m.Mod.Contains(ModShift) {
		s += "shift+"
	}

	str := m.Button.String()
	if str == "" {
		s += "unknown"
	} else if str != "none" { // motion events don't have a button
		s += str
	}

	return s
}

// MouseClickEvent represents a mouse button click event.
type MouseClickEvent Mouse

// String returns a string representation of the mouse click event.
func (e MouseClickEvent) String() string {
	return Mouse(e).String()
}

// Mouse returns the underlying mouse event. This is a convenience method and
// syntactic sugar to satisfy the [MouseEvent] interface, and cast the mouse
// event to [Mouse].
func (e MouseClickEvent) Mouse() Mouse {
	return Mouse(e)
}

// MouseReleaseEvent represents a mouse button release event.
type MouseReleaseEvent Mouse

// String returns a string representation of the mouse release event.
func (e MouseReleaseEvent) String() string {
	return Mouse(e).String()
}

// Mouse returns the underlying mouse event. This is a convenience method and
// syntactic sugar to satisfy the [MouseEvent] interface, and cast the mouse
// event to [Mouse].
func (e MouseReleaseEvent) Mouse() Mouse {
	return Mouse(e)
}

// MouseWheelEvent represents a mouse wheel message event.
type MouseWheelEvent Mouse

// String returns a string representation of the mouse wheel event.
func (e MouseWheelEvent) String() string {
	return Mouse(e).String()
}

// Mouse returns the underlying mouse event. This is a convenience method and
// syntactic sugar to satisfy the [MouseEvent] interface, and cast the mouse
// event to [Mouse].
func (e MouseWheelEvent) Mouse() Mouse {
	return Mouse(e)
}

// MouseMotionEvent represents a mouse motion event.
type MouseMotionEvent Mouse

// String returns a string representation of the mouse motion event.
func (e MouseMotionEvent) String() string {
	m := Mouse(e)
	if m.Button != 0 {
		return m.String() + "+motion"
	}
	return m.String() + "motion"
}

// Mouse returns the underlying mouse event. This is a convenience method and
// syntactic sugar to satisfy the [MouseEvent] interface, and cast the mouse
// event to [Mouse].
func (e MouseMotionEvent) Mouse() Mouse {
	return Mouse(e)
}

// Parse SGR-encoded mouse events; SGR extended mouse events. SGR mouse events
// look like:
//
//	ESC [ < Cb ; Cx ; Cy (M or m)
//
// where:
//
//	Cb is the encoded button code
//	Cx is the x-coordinate of the mouse
//	Cy is the y-coordinate of the mouse
//	M is for button press, m is for button release
//
// https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Extended-coordinates
func parseSGRMouseEvent(cmd ansi.Cmd, params ansi.Params) Event {
	x, _, ok := params.Param(1, 1)
	if !ok {
		x = 1
	}
	y, _, ok := params.Param(2, 1)
	if !ok {
		y = 1
	}
	release := cmd.Final() == 'm'
	b, _, _ := params.Param(0, 0)
	mod, btn, _, isMotion := parseMouseButton(b)

	// (1,1) is the upper left. We subtract 1 to normalize it to (0,0).
	x--
	y--

	m := Mouse{X: x, Y: y, Button: btn, Mod: mod}

	// Wheel buttons don't have release events
	// Motion can be reported as a release event in some terminals (Windows Terminal)
	if isWheel(m.Button) {
		return MouseWheelEvent(m)
	} else if !isMotion && release {
		return MouseReleaseEvent(m)
	} else if isMotion {
		return MouseMotionEvent(m)
	}
	return MouseClickEvent(m)
}

const x10MouseByteOffset = 32

// Parse X10-encoded mouse events; the simplest kind. The last release of X10
// was December 1986, by the way. The original X10 mouse protocol limits the Cx
// and Cy coordinates to 223 (=255-032).
//
// X10 mouse events look like:
//
//	ESC [M Cb Cx Cy
//
// See: http://www.xfree86.org/current/ctlseqs.html#Mouse%20Tracking
func parseX10MouseEvent(buf []byte) Event {
	v := buf[3:6]
	b := int(v[0])
	if b >= x10MouseByteOffset {
		// XXX: b < 32 should be impossible, but we're being defensive.
		b -= x10MouseByteOffset
	}

	mod, btn, isRelease, isMotion := parseMouseButton(b)

	// (1,1) is the upper left. We subtract 1 to normalize it to (0,0).
	x := int(v[1]) - x10MouseByteOffset - 1
	y := int(v[2]) - x10MouseByteOffset - 1

	m := Mouse{X: x, Y: y, Button: btn, Mod: mod}
	if isWheel(m.Button) {
		return MouseWheelEvent(m)
	} else if isMotion {
		return MouseMotionEvent(m)
	} else if isRelease {
		return MouseReleaseEvent(m)
	}
	return MouseClickEvent(m)
}

// See: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Extended-coordinates
func parseMouseButton(b int) (mod KeyMod, btn MouseButton, isRelease bool, isMotion bool) {
	// mouse bit shifts
	const (
		bitShift  = 0b0000_0100
		bitAlt    = 0b0000_1000
		bitCtrl   = 0b0001_0000
		bitMotion = 0b0010_0000
		bitWheel  = 0b0100_0000
		bitAdd    = 0b1000_0000 // additional buttons 8-11

		bitsMask = 0b0000_0011
	)

	// Modifiers
	if b&bitAlt != 0 {
		mod |= ModAlt
	}
	if b&bitCtrl != 0 {
		mod |= ModCtrl
	}
	if b&bitShift != 0 {
		mod |= ModShift
	}

	if b&bitAdd != 0 {
		btn = MouseBackward + MouseButton(b&bitsMask)
	} else if b&bitWheel != 0 {
		btn = MouseWheelUp + MouseButton(b&bitsMask)
	} else {
		btn = MouseLeft + MouseButton(b&bitsMask)
		// X10 reports a button release as 0b0000_0011 (3)
		if b&bitsMask == bitsMask {
			btn = MouseNone
			isRelease = true
		}
	}

	// Motion bit doesn't get reported for wheel events.
	if b&bitMotion != 0 && !isWheel(btn) {
		isMotion = true
	}

	return //nolint:nakedret
}

// isWheel returns true if the mouse event is a wheel event.
func isWheel(btn MouseButton) bool {
	return btn >= MouseWheelUp && btn <= MouseWheelRight
}
