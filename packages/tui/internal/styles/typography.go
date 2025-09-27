package styles

import (
	"github.com/sst/opencode/internal/theme"
)

// Typography styles for consistent visual hierarchy
var (
	t      = theme.CurrentTheme()
	H1     = NewStyle().Foreground(t.Primary()).Bold(true)        // Section titles, dialog headings
	H2     = NewStyle().Foreground(t.Text()).Bold(true)           // Secondary titles
	Body   = NewStyle().Foreground(t.Text())                      // Default text
	Muted  = NewStyle().Foreground(t.TextMuted()).Faint(true)     // Hints, timestamps
	Strong = NewStyle().Foreground(t.Accent()).Bold(true)         // Call-outs, hotkeys
)

// Spacing constants for consistent layout
const (
	SpX = 2 // horizontal padding in cells
	SpY = 1 // vertical padding in lines
)

// Surface tokens for layered backgrounds
func Surface0() Style { return NewStyle().Background(t.Background()) }                   // Canvas
func Surface1() Style { return NewStyle().Background(t.BackgroundPanel()) }             // Main panels  
func Surface2() Style { return NewStyle().Background(t.BackgroundElement()) }           // Status bar, dialogs, active items

// Separator for subtle visual divisions
func Separator() Style {
	return NewStyle().Foreground(t.BorderSubtle())
}

// Soft color variants for backgrounds (simplified approach)
func SoftSuccess() Style {
	return NewStyle().Background(t.Background()).Foreground(t.Success())
}

func SoftWarning() Style {
	return NewStyle().Background(t.Background()).Foreground(t.Warning())
}

func SoftError() Style {
	return NewStyle().Background(t.Background()).Foreground(t.Error())
}
