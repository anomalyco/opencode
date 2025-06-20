package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// OneDarkTheme implements the Theme interface with One Dark colors.
// It provides both dark and light variants.
type OneDarkTheme struct {
	BaseTheme
}

// NewOneDarkTheme creates a new instance of the One Dark theme.
func NewOneDarkTheme() *OneDarkTheme {
	// One Dark color palette based on Zed's One Dark theme
	// Dark mode colors - One Dark variant
	darkStep1 := "#282c33"  // App background (editor.background)
	darkStep2 := "#2f343e"  // Subtle background (surface.background)
	darkStep3 := "#2e343e"  // UI element background (element.background)
	darkStep4 := "#363c46"  // Hovered UI element background (element.hover)
	darkStep5 := "#454a56"  // Active/Selected UI element background (element.active)
	darkStep6 := "#464b57"  // Subtle borders and separators (border)
	darkStep7 := "#464b57"  // UI element border and focus rings (border)
	darkStep8 := "#47679e"  // Hovered UI element border (border.focused)
	darkStep9 := "#74ade8"  // Solid backgrounds (text.accent)
	darkStep10 := "#73ade9" // Hovered solid backgrounds
	darkStep11 := "#a9afbc" // Low-contrast text (text.muted)
	darkStep12 := "#dce0e5" // High-contrast text (text)

	// Dark mode accent colors from One Dark syntax
	darkRed := "#d07277"     // syntax.property, syntax.enum
	darkOrange := "#bf956a"  // syntax.number, syntax.boolean
	darkYellow := "#dec184"  // syntax.constant
	darkGreen := "#a1c181"   // syntax.string
	darkCyan := "#6eb4bf"    // syntax.operator, syntax.type
	darkBlue := darkStep9    // Using step 9 for primary
	darkPurple := "#b477cf"  // syntax.keyword

	// Light mode colors - One Light variant
	lightStep1 := "#fafafa"  // App background (editor.background)
	lightStep2 := "#ebebec"  // Subtle background (surface.background)
	lightStep3 := "#ebebec"  // UI element background (element.background)
	lightStep4 := "#dfdfe0"  // Hovered UI element background (element.hover)
	lightStep5 := "#cacaca"  // Active/Selected UI element background (element.active)
	lightStep6 := "#c9c9ca"  // Subtle borders and separators (border)
	lightStep7 := "#c9c9ca"  // UI element border and focus rings (border)
	lightStep8 := "#7d82e8"  // Hovered UI element border (border.focused)
	lightStep9 := "#5c78e2"  // Solid backgrounds (text.accent)
	lightStep10 := "#5b79e3" // Hovered solid backgrounds
	lightStep11 := "#58585a" // Low-contrast text (text.muted)
	lightStep12 := "#242529" // High-contrast text (text)

	// Light mode accent colors from One Light syntax
	lightRed := "#d36151"    // syntax.property, syntax.enum
	lightOrange := "#ad6e25" // syntax.number, syntax.boolean
	lightYellow := "#a48819" // syntax.constant (modified/warning)
	lightGreen := "#669f59"  // syntax.string
	lightCyan := "#3a82b7"   // syntax.operator, syntax.type
	lightBlue := lightStep9  // Using step 9 for primary
	lightPurple := "#a449ab" // syntax.keyword

	// Unused variables to avoid compiler errors (these could be used for hover states)
	_ = darkStep4
	_ = darkStep5
	_ = darkStep10
	_ = lightStep4
	_ = lightStep5
	_ = lightStep10

	theme := &OneDarkTheme{}

	// Base colors
	theme.PrimaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.SecondaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.AccentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
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
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
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

	// Diff view colors using One Dark version control colors
	theme.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#27a657"), // version_control.added
		Light: lipgloss.Color("#27a657"),
	}
	theme.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#e06c76"), // version_control.deleted
		Light: lipgloss.Color("#e06c76"),
	}
	theme.DiffContextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#acb2be"), // editor.foreground
		Light: lipgloss.Color("#242529"), // editor.foreground (light)
	}
	theme.DiffHunkHeaderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#a9afbc"), // text.muted
		Light: lipgloss.Color("#58585a"), // text.muted (light)
	}
	theme.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#a1c181"), // created color
		Light: lipgloss.Color("#669f59"), // created color (light)
	}
	theme.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#d07277"), // deleted color
		Light: lipgloss.Color("#d36151"), // deleted color (light)
	}
	theme.DiffAddedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#a1c1811a"), // created.background
		Light: lipgloss.Color("#dfeadb"), // created.background (light)
	}
	theme.DiffRemovedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#d072771a"), // deleted.background
		Light: lipgloss.Color("#fbdfd9"), // deleted.background (light)
	}
	theme.DiffContextBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep2),
		Light: lipgloss.Color(lightStep2),
	}
	theme.DiffLineNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#4e5a5f"), // editor.line_number
		Light: lipgloss.Color("#b4b4bb"), // editor.line_number (light)
	}
	theme.DiffAddedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#38482f"), // created.border
		Light: lipgloss.Color("#c8dcc1"), // created.border (light)
	}
	theme.DiffRemovedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#4c2b2c"), // deleted.border
		Light: lipgloss.Color("#f6c6bd"), // deleted.border (light)
	}

	// Markdown colors
	theme.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep12),
		Light: lipgloss.Color(lightStep12),
	}
	theme.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
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
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
	}
	theme.MarkdownHorizontalRuleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkStep11),
		Light: lipgloss.Color(lightStep11),
	}
	theme.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkCyan),
		Light: lipgloss.Color(lightCyan),
	}
	theme.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
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
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
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
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
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
	// Register the One Dark theme with the theme manager
	RegisterTheme("onedark", NewOneDarkTheme())
}
