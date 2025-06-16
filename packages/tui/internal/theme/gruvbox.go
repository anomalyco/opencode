package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// GruvboxTheme implements the Theme interface with Gruvbox colors.
// It provides both dark and light variants with warm, earthy tones.
type GruvboxTheme struct {
	BaseTheme
}

// NewGruvboxTheme creates a new instance of the Gruvbox theme with both dark and light variants.
func NewGruvboxTheme() *GruvboxTheme {
	// Gruvbox Dark Hard color palette
	// Background colors
	darkBg := "#1d2021"  // Hard dark background
	darkBg0 := "#282828" // Dark background
	darkBg1 := "#3c3836" // Dark background subtle
	darkBg2 := "#504945" // Dark background element
	darkBg3 := "#665c54" // Dark background muted
	darkBg4 := "#7c6f64" // Dark background active

	// Foreground colors
	darkFg0 := "#fbf1c7" // Light foreground primary
	darkFg1 := "#ebdbb2" // Light foreground secondary
	darkFg2 := "#d5c4a1" // Light foreground muted
	darkFg4 := "#a89984" // Light foreground very muted

	// Dark mode bright colors
	darkRed := "#fb4934"    // Bright red
	darkGreen := "#b8bb26"  // Bright green
	darkYellow := "#fabd2f" // Bright yellow
	darkBlue := "#83a598"   // Bright blue
	darkPurple := "#d3869b" // Bright purple
	darkAqua := "#8ec07c"   // Bright aqua
	darkOrange := "#fe8019" // Bright orange

	// Gray colors
	darkGray := "#928374" // Dark gray

	// Gruvbox Light Hard color palette
	// Background colors
	lightBg := "#f9f5d7"  // Hard light background
	lightBg0 := "#fbf1c7" // Light background
	lightBg1 := "#ebdbb2" // Light background subtle
	lightBg2 := "#d5c4a1" // Light background element
	lightBg3 := "#bdae93" // Light background muted
	lightBg4 := "#a89984" // Light background active

	// Foreground colors
	lightFg0 := "#282828" // Dark foreground primary
	lightFg1 := "#3c3836" // Dark foreground secondary
	lightFg2 := "#504945" // Dark foreground muted
	lightFg4 := "#7c6f64" // Dark foreground very muted

	// Light mode colors (darker variants for better contrast)
	lightRed := "#cc241d"    // Dark red
	lightGreen := "#98971a"  // Dark green
	lightYellow := "#d79921" // Dark yellow
	lightBlue := "#458588"   // Dark blue
	lightPurple := "#b16286" // Dark purple
	lightAqua := "#689d6a"   // Dark aqua
	lightOrange := "#d65d0e" // Dark orange

	// Gray colors
	lightGray := "#928374" // Gray

	// Unused variables to avoid compiler errors (these could be used for hover states)
	_ = darkBg4
	_ = lightBg4

	theme := &GruvboxTheme{}

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
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}

	// Status colors
	theme.ErrorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.WarningColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.SuccessColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.InfoColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAqua),
		Light: lipgloss.Color(lightAqua),
	}

	// Text colors
	theme.TextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg0),
		Light: lipgloss.Color(lightFg0),
	}
	theme.TextMutedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg2),
		Light: lipgloss.Color(lightFg2),
	}

	// Background colors
	theme.BackgroundColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg),
		Light: lipgloss.Color(lightBg),
	}
	theme.BackgroundSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg0),
		Light: lipgloss.Color(lightBg0),
	}
	theme.BackgroundElementColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg1),
		Light: lipgloss.Color(lightBg1),
	}

	// Border colors
	theme.BorderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg3),
		Light: lipgloss.Color(lightBg3),
	}
	theme.BorderActiveColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg4),
		Light: lipgloss.Color(lightFg4),
	}
	theme.BorderSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg2),
		Light: lipgloss.Color(lightBg2),
	}

	// Diff view colors
	theme.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.DiffContextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg2),
		Light: lipgloss.Color(lightFg2),
	}
	theme.DiffHunkHeaderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.DiffAddedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2d3016"),
		Light: lipgloss.Color("#d5e5d5"),
	}
	theme.DiffRemovedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#3d1a1a"),
		Light: lipgloss.Color("#f7d8db"),
	}
	theme.DiffContextBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg0),
		Light: lipgloss.Color(lightBg0),
	}
	theme.DiffLineNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg4),
		Light: lipgloss.Color(lightFg4),
	}
	theme.DiffAddedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#252b16"),
		Light: lipgloss.Color("#c5d5c5"),
	}
	theme.DiffRemovedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2b1616"),
		Light: lipgloss.Color("#e7c8cb"),
	}

	// Markdown colors
	theme.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg0),
		Light: lipgloss.Color(lightFg0),
	}
	theme.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.MarkdownLinkTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAqua),
		Light: lipgloss.Color(lightAqua),
	}
	theme.MarkdownCodeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
	}
	theme.MarkdownBlockQuoteColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGray),
		Light: lipgloss.Color(lightGray),
	}
	theme.MarkdownEmphColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.MarkdownStrongColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.MarkdownHorizontalRuleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg3),
		Light: lipgloss.Color(lightBg3),
	}
	theme.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkAqua),
		Light: lipgloss.Color(lightAqua),
	}
	theme.MarkdownImageTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.MarkdownCodeBlockColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
	}

	// Syntax highlighting colors
	theme.SyntaxCommentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGray),
		Light: lipgloss.Color(lightGray),
	}
	theme.SyntaxKeywordColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkRed),
		Light: lipgloss.Color(lightRed),
	}
	theme.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.SyntaxVariableColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBlue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.SyntaxStringColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGreen),
		Light: lipgloss.Color(lightGreen),
	}
	theme.SyntaxNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkPurple),
		Light: lipgloss.Color(lightPurple),
	}
	theme.SyntaxTypeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkYellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.SyntaxOperatorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkOrange),
		Light: lipgloss.Color(lightOrange),
	}
	theme.SyntaxPunctuationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg1),
		Light: lipgloss.Color(lightFg1),
	}

	return theme
}

func init() {
	// Register the Gruvbox theme with the theme manager
	RegisterTheme("gruvbox", NewGruvboxTheme())
}
