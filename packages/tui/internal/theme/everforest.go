package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// EverforestTheme implements the Theme interface with Everforest colors.
// It provides both dark and light variants with Medium (default) contrast.
type EverforestTheme struct {
	BaseTheme
}

// NewEverforestTheme creates a new instance of the Everforest Medium theme.
func NewEverforestTheme() *EverforestTheme {
	// Everforest color palette - Medium variant
	// Official colors from https://github.com/sainnhe/everforest/wiki
	// Dark mode colors - using Everforest:Dark Medium contrast palette
	darkStep1 := "#2d353b"  // App background
	darkStep2 := "#333c43"  // Subtle background
	darkStep3 := "#343f44"  // UI element background
	darkStep4 := "#3d484d"  // Hovered UI element background
	darkStep5 := "#475258"  // Active/Selected UI element background
	darkStep6 := "#7a8478"  // Subtle borders and separators
	darkStep7 := "#859289"  // UI element border and focus rings
	darkStep8 := "#9da9a0"  // Hovered UI element border
	darkStep9 := "#a7c080"  // Solid backgrounds
	darkStep10 := "#83c092" // Hovered solid backgrounds
	darkStep11 := "#7a8478" // Low-contrast text
	darkStep12 := "#d3c6aa" // High-contrast text

	// Dark mode accent colors
	darkPrimary := darkStep9   // Primary uses step 9 (green)
	darkSecondary := "#7fbbb3" // Secondary (blue)
	darkAccent := "#d699b6"    // Accent (purple)
	darkRed := "#e67e80"       // Error (red)
	darkOrange := "#e69875"    // Warning (orange)
	darkGreen := "#a7c080"     // Success (green)
	darkCyan := "#83c092"      // Info (aqua)
	darkYellow := "#dbbc7f"    // Emphasized text

	// Light mode colors for the Everforest:Light Medium contrast palette
	lightStep1 := "#fdf6e3"  // App background
	lightStep2 := "#efebd4"  // Subtle background
	lightStep3 := "#f4f0d9"  // UI element background
	lightStep4 := "#efebd4"  // Hovered UI element background
	lightStep5 := "#e6e2cc"  // Active/Selected UI element background
	lightStep6 := "#a6b0a0"  // Subtle borders and separators
	lightStep7 := "#939f91"  // UI element border and focus rings
	lightStep8 := "#829181"  // Hovered UI element border
	lightStep9 := "#8da101"  // Solid backgrounds
	lightStep10 := "#35a77c" // Hovered solid backgrounds
	lightStep11 := "#a6b0a0" // Low-contrast text
	lightStep12 := "#5c6a72" // High-contrast text

	// Light mode accent colors
	lightPrimary := lightStep9  // Primary uses step 9 (green)
	lightSecondary := "#3a94c5" // Secondary blue
	lightAccent := "#df69ba"    // Accent purple
	lightRed := "#f85552"       // Error red
	lightOrange := "#f57d26"    // Warning orange
	lightGreen := "#8da101"     // Success green
	lightCyan := "#35a77c"      // Info aqua
	lightYellow := "#dfa000"    // Emphasized text

	// Unused variables. These could be used for hover states
	_ = darkStep4
	_ = darkStep5
	_ = darkStep10
	_ = lightStep4
	_ = lightStep5
	_ = lightStep10

	theme := &EverforestTheme{}

	// Base colors
	theme.PrimaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPrimary),
		Light: lipgloss.Color(lightPrimary),
	}
	theme.SecondaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkSecondary),
		Light: lipgloss.Color(lightSecondary),
	}
	theme.AccentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAccent),
		Light: lipgloss.Color(lightAccent),
	}

	// Status colors
	theme.ErrorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.WarningColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
	}
	theme.SuccessColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.InfoColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}

	// Text colors
	theme.TextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep12),
		Light: lipgloss.Color(lightStep12),
	}
	theme.TextMutedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep11),
		Light: lipgloss.Color(lightStep11),
	}

	// Background colors
	theme.BackgroundColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep1),
		Light: lipgloss.Color(lightStep1),
	}
	theme.BackgroundSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep2),
		Light: lipgloss.Color(lightStep2),
	}
	theme.BackgroundElementColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep3),
		Light: lipgloss.Color(lightStep3),
	}

	// Border colors
	theme.BorderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep7),
		Light: lipgloss.Color(lightStep7),
	}
	theme.BorderActiveColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep8),
		Light: lipgloss.Color(lightStep8),
	}
	theme.BorderSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep6),
		Light: lipgloss.Color(lightStep6),
	}

	// Diff view colors
	theme.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#A7C080"),
		Light: lipgloss.Color("#8DA101"),
	}
	theme.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#E67E80"),
		Light: lipgloss.Color("#F85552"),
	}
	theme.DiffContextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#7A8478"),
		Light: lipgloss.Color("#A6B0A0"),
	}
	theme.DiffHunkHeaderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#859289"),
		Light: lipgloss.Color("#939F91"),
	}
	theme.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#A7C080"),
		Light: lipgloss.Color("#8DA101"),
	}
	theme.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#E67E80"),
		Light: lipgloss.Color("#F85552"),
	}
	theme.DiffAddedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#425047"),
		Light: lipgloss.Color("#F0F1D2"),
	}
	theme.DiffRemovedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#543A48"),
		Light: lipgloss.Color("#FBE3DA"),
	}
	theme.DiffContextBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep2),
		Light: lipgloss.Color(lightStep2),
	}
	theme.DiffLineNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep3),
		Light: lipgloss.Color(lightStep3),
	}
	theme.DiffAddedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#3A4A3F"),
		Light: lipgloss.Color("#E8F2D1"),
	}
	theme.DiffRemovedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#4A3A40"),
		Light: lipgloss.Color("#FBDAD2"),
	}

	// Markdown colors
	theme.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep12),
		Light: lipgloss.Color(lightStep12),
	}
	theme.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkSecondary),
		Light: lipgloss.Color(lightSecondary),
	}
	theme.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPrimary),
		Light: lipgloss.Color(lightPrimary),
	}
	theme.MarkdownLinkTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}
	theme.MarkdownCodeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.MarkdownBlockQuoteColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.MarkdownEmphColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.MarkdownStrongColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAccent),
		Light: lipgloss.Color(lightAccent),
	}
	theme.MarkdownHorizontalRuleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep11),
		Light: lipgloss.Color(lightStep11),
	}
	theme.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPrimary),
		Light: lipgloss.Color(lightPrimary),
	}
	theme.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}
	theme.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPrimary),
		Light: lipgloss.Color(lightPrimary),
	}
	theme.MarkdownImageTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}
	theme.MarkdownCodeBlockColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep12),
		Light: lipgloss.Color(lightStep12),
	}

	// Syntax highlighting colors
	theme.SyntaxCommentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep11),
		Light: lipgloss.Color(lightStep11),
	}
	theme.SyntaxKeywordColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPrimary),
		Light: lipgloss.Color(lightPrimary),
	}
	theme.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkSecondary),
		Light: lipgloss.Color(lightSecondary),
	}
	theme.SyntaxVariableColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.SyntaxStringColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.SyntaxNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAccent),
		Light: lipgloss.Color(lightAccent),
	}
	theme.SyntaxTypeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.SyntaxOperatorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}
	theme.SyntaxPunctuationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep12),
		Light: lipgloss.Color(lightStep12),
	}

	return theme
}

func init() {
	// Register the Everforest theme with the theme manager
	RegisterTheme("everforest", NewEverforestTheme())
}
