package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// CatppuccinMochaTheme implements the Theme interface with Catppuccin Mocha colors.
// Based on the official Catppuccin Mocha palette.
type CatppuccinMochaTheme struct {
	BaseTheme
}

// NewCatppuccinMochaTheme creates a new instance of the Catppuccin Mocha theme.
func NewCatppuccinMochaTheme() *CatppuccinMochaTheme {
	// Catppuccin Mocha color palette - official colors
	// Base colors (backgrounds and surfaces)
	base := "#1e1e2e"       // main background
	mantle := "#181825"     // darker background
	crust := "#11111b"      // darkest background
	
	// Surface colors (UI elements)
	surface0 := "#313244"   // subtle UI elements
	surface1 := "#45475a"   // UI element backgrounds
	surface2 := "#585b70"   // active/selected UI elements
	
	// Overlay colors (borders and separators)
	overlay0 := "#6c7086"   // muted borders
	overlay1 := "#7f849c"   // borders
	overlay2 := "#9399b2"   // active borders
	
	// Text colors
	subtext0 := "#a6adc8"   // muted text
	subtext1 := "#bac2de"   // secondary text
	text := "#cdd6f4"       // primary text
	
	// Accent colors - Catppuccin signature colors
	rosewater := "#f5e0dc"
	flamingo := "#f2cdcd"
	pink := "#f5c2e7"
	mauve := "#cba6f7"      // purple
	red := "#f38ba8"
	maroon := "#eba0ac"
	peach := "#fab387"      // orange
	yellow := "#f9e2af"
	green := "#a6e3a1"
	teal := "#94e2d5"
	sky := "#89dceb"
	sapphire := "#74c7ec"
	blue := "#89b4fa"
	lavender := "#b4befe"
	
	// Light mode colors (Catppuccin Latte variant)
	lightBase := "#eff1f5"      // main background
	lightMantle := "#e6e9ef"    // darker background
	lightSurface0 := "#ccd0da"  // subtle UI elements
	lightSurface1 := "#bcc0cc"  // UI element backgrounds
	lightSurface2 := "#acb0be"  // active/selected UI elements
	lightOverlay0 := "#9ca0b0"  // muted borders
	lightOverlay1 := "#8c8fa1"  // borders
	lightOverlay2 := "#7c7f93"  // active borders
	lightSubtext0 := "#6c6f85"  // muted text
	lightSubtext1 := "#5c5f77"  // secondary text
	lightText := "#4c4f69"      // primary text
	
	// Light mode accent colors
	lightRed := "#d20f39"
	lightMaroon := "#e64553"
	lightPeach := "#fe640b"
	lightYellow := "#df8e1d"
	lightGreen := "#40a02b"
	lightTeal := "#179299"
	lightSky := "#04a5e5"
	lightSapphire := "#209fb5"
	lightBlue := "#1e66f5"
	lightLavender := "#7287fd"
	lightMauve := "#8839ef"
	lightPink := "#ea76cb"

	theme := &CatppuccinMochaTheme{}

	// Base colors
	theme.PrimaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(mauve),
		Light: lipgloss.Color(lightMauve),
	}
	theme.SecondaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(blue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.AccentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(peach),
		Light: lipgloss.Color(lightPeach),
	}

	// Status colors
	theme.ErrorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(red),
		Light: lipgloss.Color(lightRed),
	}
	theme.WarningColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(yellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.SuccessColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(green),
		Light: lipgloss.Color(lightGreen),
	}
	theme.InfoColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(sky),
		Light: lipgloss.Color(lightSky),
	}

	// Text colors
	theme.TextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(text),
		Light: lipgloss.Color(lightText),
	}
	theme.TextMutedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(subtext1),
		Light: lipgloss.Color(lightSubtext1),
	}

	// Background colors
	theme.BackgroundColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(base),
		Light: lipgloss.Color(lightBase),
	}
	theme.BackgroundSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(mantle),
		Light: lipgloss.Color(lightMantle),
	}
	theme.BackgroundElementColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(surface0),
		Light: lipgloss.Color(lightSurface0),
	}

	// Border colors
	theme.BorderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(overlay1),
		Light: lipgloss.Color(lightOverlay1),
	}
	theme.BorderActiveColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(overlay2),
		Light: lipgloss.Color(lightOverlay2),
	}
	theme.BorderSubtleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(overlay0),
		Light: lipgloss.Color(lightOverlay0),
	}

	// Diff view colors
	theme.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(green),
		Light: lipgloss.Color(lightGreen),
	}
	theme.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(red),
		Light: lipgloss.Color(lightRed),
	}
	theme.DiffContextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(subtext0),
		Light: lipgloss.Color(lightSubtext0),
	}
	theme.DiffHunkHeaderColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(lavender),
		Light: lipgloss.Color(lightLavender),
	}
	theme.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(teal),
		Light: lipgloss.Color(lightTeal),
	}
	theme.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(maroon),
		Light: lipgloss.Color(lightMaroon),
	}
	theme.DiffAddedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#1e2e1e"),
		Light: lipgloss.Color("#d5f5d5"),
	}
	theme.DiffRemovedBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2e1e1e"),
		Light: lipgloss.Color("#f5d5d5"),
	}
	theme.DiffContextBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(mantle),
		Light: lipgloss.Color(lightMantle),
	}
	theme.DiffLineNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(surface1),
		Light: lipgloss.Color(lightSurface1),
	}
	theme.DiffAddedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#1a2a1a"),
		Light: lipgloss.Color("#c5e5c5"),
	}
	theme.DiffRemovedLineNumberBgColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("#2a1a1a"),
		Light: lipgloss.Color("#e5c5c5"),
	}

	// Markdown colors
	theme.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(text),
		Light: lipgloss.Color(lightText),
	}
	theme.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(mauve),
		Light: lipgloss.Color(lightMauve),
	}
	theme.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(blue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.MarkdownLinkTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(sapphire),
		Light: lipgloss.Color(lightSapphire),
	}
	theme.MarkdownCodeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(green),
		Light: lipgloss.Color(lightGreen),
	}
	theme.MarkdownBlockQuoteColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(yellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.MarkdownEmphColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(pink),
		Light: lipgloss.Color(lightPink),
	}
	theme.MarkdownStrongColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(peach),
		Light: lipgloss.Color(lightPeach),
	}
	theme.MarkdownHorizontalRuleColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(overlay1),
		Light: lipgloss.Color(lightOverlay1),
	}
	theme.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(blue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(sapphire),
		Light: lipgloss.Color(lightSapphire),
	}
	theme.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(lavender),
		Light: lipgloss.Color(lightLavender),
	}
	theme.MarkdownImageTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(sky),
		Light: lipgloss.Color(lightSky),
	}
	theme.MarkdownCodeBlockColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(text),
		Light: lipgloss.Color(lightText),
	}

	// Syntax highlighting colors
	theme.SyntaxCommentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(subtext0),
		Light: lipgloss.Color(lightSubtext0),
	}
	theme.SyntaxKeywordColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(mauve),
		Light: lipgloss.Color(lightMauve),
	}
	theme.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(blue),
		Light: lipgloss.Color(lightBlue),
	}
	theme.SyntaxVariableColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(flamingo),
		Light: lipgloss.Color(lightRed),
	}
	theme.SyntaxStringColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(green),
		Light: lipgloss.Color(lightGreen),
	}
	theme.SyntaxNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(peach),
		Light: lipgloss.Color(lightPeach),
	}
	theme.SyntaxTypeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(yellow),
		Light: lipgloss.Color(lightYellow),
	}
	theme.SyntaxOperatorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(sky),
		Light: lipgloss.Color(lightSky),
	}
	theme.SyntaxPunctuationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color(overlay2),
		Light: lipgloss.Color(lightOverlay2),
	}

	return theme
}

func init() {
	// Register the Catppuccin Mocha theme with the theme manager
	RegisterTheme("catppuccin", NewCatppuccinMochaTheme())
}