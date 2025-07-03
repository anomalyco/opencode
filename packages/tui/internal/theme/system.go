package theme

import (
	"fmt"
	"image/color"
	"math"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

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
	// Generate gray scale based on terminal background
	grays := t.generateGrayScale()

	// Set ANSI colors for primary colors
	t.PrimaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Cyan,
		Light: lipgloss.Cyan,
	}
	t.SecondaryColor = compat.AdaptiveColor{
		Dark:  lipgloss.Magenta,
		Light: lipgloss.Magenta,
	}
	t.AccentColor = compat.AdaptiveColor{
		Dark:  lipgloss.Cyan,
		Light: lipgloss.Cyan,
	}

	// Status colors using ANSI
	t.ErrorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Red,
		Light: lipgloss.Red,
	}
	t.WarningColor = compat.AdaptiveColor{
		Dark:  lipgloss.Yellow,
		Light: lipgloss.Yellow,
	}
	t.SuccessColor = compat.AdaptiveColor{
		Dark:  lipgloss.Green,
		Light: lipgloss.Green,
	}
	t.InfoColor = compat.AdaptiveColor{
		Dark:  lipgloss.Cyan,
		Light: lipgloss.Cyan,
	}

	// Text colors
	t.TextColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	// Derive muted text color from terminal foreground
	t.TextMutedColor = t.generateMutedTextColor()

	// Background colors
	t.BackgroundColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	t.BackgroundPanelColor = grays[2]
	t.BackgroundElementColor = grays[3]

	// Border colors
	t.BorderSubtleColor = grays[6]
	t.BorderColor = grays[7]
	t.BorderActiveColor = grays[8]

	// Diff colors using ANSI colors
	t.DiffAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("2"), // green
		Light: lipgloss.Color("2"),
	}
	t.DiffRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("1"), // red
		Light: lipgloss.Color("1"),
	}
	t.DiffContextColor = grays[7] // Use gray for context
	t.DiffHunkHeaderColor = grays[7]
	t.DiffHighlightAddedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("2"), // green
		Light: lipgloss.Color("2"),
	}
	t.DiffHighlightRemovedColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("1"), // red
		Light: lipgloss.Color("1"),
	}
	// Use subtle gray backgrounds for diff
	t.DiffAddedBgColor = grays[2]
	t.DiffRemovedBgColor = grays[2]
	t.DiffContextBgColor = grays[1]
	t.DiffLineNumberColor = grays[6]
	t.DiffAddedLineNumberBgColor = grays[3]
	t.DiffRemovedLineNumberBgColor = grays[3]

	// Markdown colors using ANSI
	t.MarkdownTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	t.MarkdownHeadingColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	t.MarkdownLinkColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("4"), // blue
		Light: lipgloss.Color("4"),
	}
	t.MarkdownLinkTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("6"), // cyan
		Light: lipgloss.Color("6"),
	}
	t.MarkdownCodeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("2"), // green
		Light: lipgloss.Color("2"),
	}
	t.MarkdownBlockQuoteColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("3"), // yellow
		Light: lipgloss.Color("3"),
	}
	t.MarkdownEmphColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("3"), // yellow
		Light: lipgloss.Color("3"),
	}
	t.MarkdownStrongColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	t.MarkdownHorizontalRuleColor = t.BorderColor
	t.MarkdownListItemColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("4"), // blue
		Light: lipgloss.Color("4"),
	}
	t.MarkdownListEnumerationColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("6"), // cyan
		Light: lipgloss.Color("6"),
	}
	t.MarkdownImageColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("4"), // blue
		Light: lipgloss.Color("4"),
	}
	t.MarkdownImageTextColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("6"), // cyan
		Light: lipgloss.Color("6"),
	}
	t.MarkdownCodeBlockColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}

	// Syntax colors
	t.SyntaxCommentColor = t.TextMutedColor // Use same as muted text
	t.SyntaxKeywordColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("5"), // magenta
		Light: lipgloss.Color("5"),
	}
	t.SyntaxFunctionColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("4"), // blue
		Light: lipgloss.Color("4"),
	}
	t.SyntaxVariableColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
	t.SyntaxStringColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("2"), // green
		Light: lipgloss.Color("2"),
	}
	t.SyntaxNumberColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("3"), // yellow
		Light: lipgloss.Color("3"),
	}
	t.SyntaxTypeColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("6"), // cyan
		Light: lipgloss.Color("6"),
	}
	t.SyntaxOperatorColor = compat.AdaptiveColor{
		Dark:  lipgloss.Color("6"), // cyan
		Light: lipgloss.Color("6"),
	}
	t.SyntaxPunctuationColor = compat.AdaptiveColor{
		Dark:  lipgloss.NoColor{},
		Light: lipgloss.NoColor{},
	}
}

// generateGrayScale creates a gray scale based on the terminal background
func (t *SystemTheme) generateGrayScale() map[int]compat.AdaptiveColor {
	grays := make(map[int]compat.AdaptiveColor)

	r, g, b, _ := t.terminalBg.RGBA()
	bgR := float64(r >> 8)
	bgG := float64(g >> 8)
	bgB := float64(b >> 8)

	luminance := 0.299*bgR + 0.587*bgG + 0.114*bgB

	for i := 1; i <= 12; i++ {
		var stepColor string
		factor := float64(i) / 12.0

		if t.terminalBgIsDark {
			if luminance < 10 {
				grayValue := int(factor * 0.4 * 255)
				stepColor = fmt.Sprintf("#%02x%02x%02x", grayValue, grayValue, grayValue)
			} else {
				newLum := luminance + (255-luminance)*factor*0.4

				ratio := newLum / luminance
				newR := math.Min(bgR*ratio, 255)
				newG := math.Min(bgG*ratio, 255)
				newB := math.Min(bgB*ratio, 255)

				stepColor = fmt.Sprintf("#%02x%02x%02x", int(newR), int(newG), int(newB))
			}
		} else {
			if luminance > 245 {
				grayValue := int(255 - factor*0.4*255)
				stepColor = fmt.Sprintf("#%02x%02x%02x", grayValue, grayValue, grayValue)
			} else {
				newLum := luminance * (1 - factor*0.4)

				ratio := newLum / luminance
				newR := math.Max(bgR*ratio, 0)
				newG := math.Max(bgG*ratio, 0)
				newB := math.Max(bgB*ratio, 0)

				stepColor = fmt.Sprintf("#%02x%02x%02x", int(newR), int(newG), int(newB))
			}
		}

		grays[i] = compat.AdaptiveColor{
			Dark:  lipgloss.Color(stepColor),
			Light: lipgloss.Color(stepColor),
		}
	}

	return grays
}

// generateMutedTextColor creates a muted gray color based on the terminal background
func (t *SystemTheme) generateMutedTextColor() compat.AdaptiveColor {
	bgR, bgG, bgB, _ := t.terminalBg.RGBA()

	bgRf := float64(bgR >> 8)
	bgGf := float64(bgG >> 8)
	bgBf := float64(bgB >> 8)

	bgLum := 0.299*bgRf + 0.587*bgGf + 0.114*bgBf

	var grayValue int
	if t.terminalBgIsDark {
		if bgLum < 10 {
			// Very dark/black background
			// grays[3] would be around #2e (46), so we need much lighter
			grayValue = 180 // #b4b4b4
		} else {
			// Scale up for lighter dark backgrounds
			// Ensure we're always significantly brighter than BackgroundElement
			grayValue = min(int(160+(bgLum*0.3)), 200)
		}
	} else {
		if bgLum > 245 {
			// Very light/white background
			// grays[3] would be around #f5 (245), so we need much darker
			grayValue = 75 // #4b4b4b
		} else {
			// Scale down for darker light backgrounds
			// Ensure we're always significantly darker than BackgroundElement
			grayValue = max(int(100-((255-bgLum)*0.2)), 60)
		}
	}

	mutedColor := fmt.Sprintf("#%02x%02x%02x", grayValue, grayValue, grayValue)

	return compat.AdaptiveColor{
		Dark:  lipgloss.Color(mutedColor),
		Light: lipgloss.Color(mutedColor),
	}
}
