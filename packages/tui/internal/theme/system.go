package theme

import (
	"image/color"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/charmbracelet/x/ansi"
)

func monoColor(c ansi.BasicColor) compat.AdaptiveColor {
	return compat.AdaptiveColor{Dark: c, Light: c}
}

func monoNoColor() compat.AdaptiveColor {
	return compat.AdaptiveColor{Dark: lipgloss.NoColor{}, Light: lipgloss.NoColor{}}
}

// SystemTheme is a dynamic theme that derives its gray scale colors
// from the terminal's background color at runtime
type SystemTheme struct {
	BaseTheme
	terminalBg       color.Color
	terminalBgIsDark bool
}

// NewSystemTheme creates a new instance of the dynamic system theme
func NewSystemTheme(terminalBg color.Color, isDark bool) *SystemTheme {
	theme := &SystemTheme{
		terminalBg:       terminalBg,
		terminalBgIsDark: isDark,
	}
	theme.initializeColors()
	return theme
}

func (t *SystemTheme) Name() string {
	return "system"
}

// initializeColors sets up all theme colors
func (t *SystemTheme) initializeColors() {
	// Set ANSI colors for primary colors
	t.PrimaryColor = monoColor(lipgloss.Cyan)
	t.SecondaryColor = monoColor(lipgloss.Magenta)
	t.AccentColor = monoColor(lipgloss.Cyan)

	// Status colors using ANSI
	t.ErrorColor = monoColor(lipgloss.Red)
	t.WarningColor = monoColor(lipgloss.Yellow)
	t.SuccessColor = monoColor(lipgloss.Green)
	t.InfoColor = monoColor(lipgloss.Cyan)

	// Text colors
	t.TextColor = monoNoColor()
	t.TextMutedColor = monoColor(lipgloss.BrightWhite)

	// Background colors
	t.BackgroundColor = monoNoColor()
	t.BackgroundPanelColor = monoColor(lipgloss.Black)
	t.BackgroundElementColor = monoColor(lipgloss.BrightBlack)

	// Border colors
	t.BorderSubtleColor = monoColor(lipgloss.Black)
	t.BorderColor = monoColor(lipgloss.BrightBlack)
	t.BorderActiveColor = monoColor(lipgloss.Blue)

	// Diff colors using ANSI colors
	t.DiffAddedColor = monoColor(lipgloss.Green)
	t.DiffRemovedColor = monoColor(lipgloss.Red)
	t.DiffContextColor = monoNoColor()
	t.DiffHunkHeaderColor = monoNoColor()
	t.DiffHighlightAddedColor = monoColor(lipgloss.Green)
	t.DiffHighlightRemovedColor = monoColor(lipgloss.Red)

	// Use subtle gray backgrounds for diff
	t.DiffAddedBgColor = monoNoColor()
	t.DiffRemovedBgColor = monoNoColor()
	t.DiffContextBgColor = monoNoColor()
	t.DiffLineNumberColor = monoColor(lipgloss.BrightWhite)
	t.DiffAddedLineNumberBgColor = monoNoColor()
	t.DiffRemovedLineNumberBgColor = monoNoColor()

	// Markdown colors using ANSI
	t.MarkdownTextColor = monoNoColor()
	t.MarkdownHeadingColor = monoNoColor()
	t.MarkdownLinkColor = monoColor(lipgloss.Blue)
	t.MarkdownLinkTextColor = monoColor(lipgloss.Cyan)
	t.MarkdownCodeColor = monoColor(lipgloss.Green)
	t.MarkdownBlockQuoteColor = monoColor(lipgloss.Yellow)
	t.MarkdownEmphColor = monoColor(lipgloss.Yellow)
	t.MarkdownStrongColor = monoNoColor()
	t.MarkdownHorizontalRuleColor = t.BorderColor
	t.MarkdownListItemColor = monoColor(lipgloss.Blue)
	t.MarkdownListEnumerationColor = monoColor(lipgloss.Cyan)
	t.MarkdownImageColor = monoColor(lipgloss.Blue)
	t.MarkdownImageTextColor = monoColor(lipgloss.Cyan)
	t.MarkdownCodeBlockColor = monoNoColor()

	// Syntax colors
	t.SyntaxCommentColor = t.TextMutedColor // Use same as muted text
	t.SyntaxKeywordColor = monoColor(lipgloss.Magenta)
	t.SyntaxFunctionColor = monoColor(lipgloss.Blue)
	t.SyntaxVariableColor = monoNoColor()
	t.SyntaxStringColor = monoColor(lipgloss.Green)
	t.SyntaxNumberColor = monoColor(lipgloss.Yellow)
	t.SyntaxTypeColor = monoColor(lipgloss.Cyan)
	t.SyntaxOperatorColor = monoColor(lipgloss.Cyan)
	t.SyntaxPunctuationColor = monoNoColor()
}
