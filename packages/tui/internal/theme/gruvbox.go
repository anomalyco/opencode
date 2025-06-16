package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// GruvboxTheme implements the Theme interface with Gruvbox Dark Hard colors.
// It provides a retro groove color scheme with warm, earthy tones.
type GruvboxTheme struct {
	BaseTheme
}

// NewGruvboxTheme creates a new instance of the Gruvbox Dark Hard theme.
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

	// Bright colors
	brightRed := "#fb4934"    // Bright red
	brightGreen := "#b8bb26"  // Bright green
	brightYellow := "#fabd2f" // Bright yellow
	brightBlue := "#83a598"   // Bright blue
	brightPurple := "#d3869b" // Bright purple
	brightAqua := "#8ec07c"   // Bright aqua
	brightOrange := "#fe8019" // Bright orange

	// Gray colors
	darkGray := "#928374" // Dark gray

	theme := &GruvboxTheme{}

	// Base colors
	theme.PrimaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightBlue),
		Light: lipgloss.Color(brightBlue),
	}
	theme.SecondaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightPurple),
		Light: lipgloss.Color(brightPurple),
	}
	theme.AccentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightYellow),
		Light: lipgloss.Color(brightYellow),
	}

	// Status colors
	theme.ErrorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightRed),
		Light: lipgloss.Color(brightRed),
	}
	theme.WarningColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightYellow),
		Light: lipgloss.Color(brightYellow),
	}
	theme.SuccessColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightGreen),
		Light: lipgloss.Color(brightGreen),
	}
	theme.InfoColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightAqua),
		Light: lipgloss.Color(brightAqua),
	}

	// Text colors
	theme.TextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg0),
		Light: lipgloss.Color(darkFg0),
	}
	theme.TextMutedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg2),
		Light: lipgloss.Color(darkFg2),
	}

	// Background colors
	theme.BackgroundColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg),
		Light: lipgloss.Color(darkBg),
	}
	theme.BackgroundSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg0),
		Light: lipgloss.Color(darkBg0),
	}
	theme.BackgroundElementColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg1),
		Light: lipgloss.Color(darkBg1),
	}

	// Border colors
	theme.BorderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg3),
		Light: lipgloss.Color(darkBg3),
	}
	theme.BorderActiveColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg4),
		Light: lipgloss.Color(darkBg4),
	}
	theme.BorderSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg2),
		Light: lipgloss.Color(darkBg2),
	}

	// Diff view colors
	theme.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightGreen),
		Light: lipgloss.Color(brightGreen),
	}
	theme.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightRed),
		Light: lipgloss.Color(brightRed),
	}
	theme.DiffContextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg2),
		Light: lipgloss.Color(darkFg2),
	}
	theme.DiffHunkHeaderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightBlue),
		Light: lipgloss.Color(brightBlue),
	}
	theme.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightGreen),
		Light: lipgloss.Color(brightGreen),
	}
	theme.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightRed),
		Light: lipgloss.Color(brightRed),
	}
	theme.DiffAddedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2d3016"),
		Light: lipgloss.Color("#2d3016"),
	}
	theme.DiffRemovedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#3d1a1a"),
		Light: lipgloss.Color("#3d1a1a"),
	}
	theme.DiffContextBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg0),
		Light: lipgloss.Color(darkBg0),
	}
	theme.DiffLineNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg4),
		Light: lipgloss.Color(darkFg4),
	}
	theme.DiffAddedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#252b16"),
		Light: lipgloss.Color("#252b16"),
	}
	theme.DiffRemovedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2b1616"),
		Light: lipgloss.Color("#2b1616"),
	}

	// Markdown colors
	theme.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg0),
		Light: lipgloss.Color(darkFg0),
	}
	theme.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightYellow),
		Light: lipgloss.Color(brightYellow),
	}
	theme.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightBlue),
		Light: lipgloss.Color(brightBlue),
	}
	theme.MarkdownLinkTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightAqua),
		Light: lipgloss.Color(brightAqua),
	}
	theme.MarkdownCodeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightOrange),
		Light: lipgloss.Color(brightOrange),
	}
	theme.MarkdownBlockQuoteColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGray),
		Light: lipgloss.Color(darkGray),
	}
	theme.MarkdownEmphColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightPurple),
		Light: lipgloss.Color(brightPurple),
	}
	theme.MarkdownStrongColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightRed),
		Light: lipgloss.Color(brightRed),
	}
	theme.MarkdownHorizontalRuleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkBg3),
		Light: lipgloss.Color(darkBg3),
	}
	theme.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightYellow),
		Light: lipgloss.Color(brightYellow),
	}
	theme.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightPurple),
		Light: lipgloss.Color(brightPurple),
	}
	theme.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightAqua),
		Light: lipgloss.Color(brightAqua),
	}
	theme.MarkdownImageTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightBlue),
		Light: lipgloss.Color(brightBlue),
	}
	theme.MarkdownCodeBlockColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightOrange),
		Light: lipgloss.Color(brightOrange),
	}

	// Syntax highlighting colors
	theme.SyntaxCommentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkGray),
		Light: lipgloss.Color(darkGray),
	}
	theme.SyntaxKeywordColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightRed),
		Light: lipgloss.Color(brightRed),
	}
	theme.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightGreen),
		Light: lipgloss.Color(brightGreen),
	}
	theme.SyntaxVariableColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightBlue),
		Light: lipgloss.Color(brightBlue),
	}
	theme.SyntaxStringColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightGreen),
		Light: lipgloss.Color(brightGreen),
	}
	theme.SyntaxNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightPurple),
		Light: lipgloss.Color(brightPurple),
	}
	theme.SyntaxTypeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightYellow),
		Light: lipgloss.Color(brightYellow),
	}
	theme.SyntaxOperatorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(brightOrange),
		Light: lipgloss.Color(brightOrange),
	}
	theme.SyntaxPunctuationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(darkFg1),
		Light: lipgloss.Color(darkFg1),
	}

	return theme
}

func init() {
	// Register the Gruvbox theme with the theme manager
	RegisterTheme("gruvbox", NewGruvboxTheme())
}
