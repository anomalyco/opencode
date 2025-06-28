package styles

import (
	"image/color"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// IsNoColor checks if a color is the special NoColor type
func IsNoColor(c color.Color) bool {
	_, ok := c.(lipgloss.NoColor)
	return ok
}

// Style wraps lipgloss.Style to provide a fluent API for handling "none" colors
type Style struct {
	lipgloss.Style
}

// NewStyle creates a new Style with proper handling of "none" colors
func NewStyle() Style {
	return Style{lipgloss.NewStyle()}
}

func (s Style) Lipgloss() lipgloss.Style {
	return s.Style
}

// Foreground sets the foreground color, handling "none" appropriately
func (s Style) Foreground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetForeground()}
	}
	return Style{s.Style.Foreground(c)}
}

// Background sets the background color, handling "none" appropriately
func (s Style) Background(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBackground()}
	}
	return Style{s.Style.Background(c)}
}

// BorderForeground sets the border foreground color, handling "none" appropriately
func (s Style) BorderForeground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderForeground()}
	}
	return Style{s.Style.BorderForeground(c)}
}

// BorderBackground sets the border background color, handling "none" appropriately
func (s Style) BorderBackground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderBackground()}
	}
	return Style{s.Style.BorderBackground(c)}
}

// BorderTopForeground sets the border top foreground color, handling "none" appropriately
func (s Style) BorderTopForeground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderTopForeground()}
	}
	return Style{s.Style.BorderTopForeground(c)}
}

// BorderTopBackground sets the border top background color, handling "none" appropriately
func (s Style) BorderTopBackground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderTopBackground()}
	}
	return Style{s.Style.BorderTopBackground(c)}
}

// BorderBottomForeground sets the border bottom foreground color, handling "none" appropriately
func (s Style) BorderBottomForeground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderBottomForeground()}
	}
	return Style{s.Style.BorderBottomForeground(c)}
}

// BorderBottomBackground sets the border bottom background color, handling "none" appropriately
func (s Style) BorderBottomBackground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderBottomBackground()}
	}
	return Style{s.Style.BorderBottomBackground(c)}
}

// BorderLeftForeground sets the border left foreground color, handling "none" appropriately
func (s Style) BorderLeftForeground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderLeftForeground()}
	}
	return Style{s.Style.BorderLeftForeground(c)}
}

// BorderLeftBackground sets the border left background color, handling "none" appropriately
func (s Style) BorderLeftBackground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderLeftBackground()}
	}
	return Style{s.Style.BorderLeftBackground(c)}
}

// BorderRightForeground sets the border right foreground color, handling "none" appropriately
func (s Style) BorderRightForeground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderRightForeground()}
	}
	return Style{s.Style.BorderRightForeground(c)}
}

// BorderRightBackground sets the border right background color, handling "none" appropriately
func (s Style) BorderRightBackground(c compat.AdaptiveColor) Style {
	if IsNoColor(c.Dark) && IsNoColor(c.Light) {
		return Style{s.Style.UnsetBorderRightBackground()}
	}
	return Style{s.Style.BorderRightBackground(c)}
}

// Render applies the style to a string
func (s Style) Render(str string) string {
	return s.Style.Render(str)
}

// Common lipgloss.Style method delegations for seamless usage

func (s Style) Bold(v bool) Style {
	return Style{s.Style.Bold(v)}
}

func (s Style) Italic(v bool) Style {
	return Style{s.Style.Italic(v)}
}

func (s Style) Underline(v bool) Style {
	return Style{s.Style.Underline(v)}
}

func (s Style) Strikethrough(v bool) Style {
	return Style{s.Style.Strikethrough(v)}
}

func (s Style) Blink(v bool) Style {
	return Style{s.Style.Blink(v)}
}

func (s Style) Faint(v bool) Style {
	return Style{s.Style.Faint(v)}
}

func (s Style) Reverse(v bool) Style {
	return Style{s.Style.Reverse(v)}
}

func (s Style) Width(i int) Style {
	return Style{s.Style.Width(i)}
}

func (s Style) Height(i int) Style {
	return Style{s.Style.Height(i)}
}

func (s Style) Padding(i ...int) Style {
	return Style{s.Style.Padding(i...)}
}

func (s Style) PaddingTop(i int) Style {
	return Style{s.Style.PaddingTop(i)}
}

func (s Style) PaddingBottom(i int) Style {
	return Style{s.Style.PaddingBottom(i)}
}

func (s Style) PaddingLeft(i int) Style {
	return Style{s.Style.PaddingLeft(i)}
}

func (s Style) PaddingRight(i int) Style {
	return Style{s.Style.PaddingRight(i)}
}

func (s Style) Margin(i ...int) Style {
	return Style{s.Style.Margin(i...)}
}

func (s Style) MarginTop(i int) Style {
	return Style{s.Style.MarginTop(i)}
}

func (s Style) MarginBottom(i int) Style {
	return Style{s.Style.MarginBottom(i)}
}

func (s Style) MarginLeft(i int) Style {
	return Style{s.Style.MarginLeft(i)}
}

func (s Style) MarginRight(i int) Style {
	return Style{s.Style.MarginRight(i)}
}

func (s Style) Border(b lipgloss.Border, sides ...bool) Style {
	return Style{s.Style.Border(b, sides...)}
}

func (s Style) BorderStyle(b lipgloss.Border) Style {
	return Style{s.Style.BorderStyle(b)}
}

func (s Style) BorderTop(v bool) Style {
	return Style{s.Style.BorderTop(v)}
}

func (s Style) BorderBottom(v bool) Style {
	return Style{s.Style.BorderBottom(v)}
}

func (s Style) BorderLeft(v bool) Style {
	return Style{s.Style.BorderLeft(v)}
}

func (s Style) BorderRight(v bool) Style {
	return Style{s.Style.BorderRight(v)}
}

func (s Style) Align(p ...lipgloss.Position) Style {
	return Style{s.Style.Align(p...)}
}

func (s Style) AlignHorizontal(p lipgloss.Position) Style {
	return Style{s.Style.AlignHorizontal(p)}
}

func (s Style) AlignVertical(p lipgloss.Position) Style {
	return Style{s.Style.AlignVertical(p)}
}

func (s Style) Inline(v bool) Style {
	return Style{s.Style.Inline(v)}
}

func (s Style) MaxWidth(n int) Style {
	return Style{s.Style.MaxWidth(n)}
}

func (s Style) MaxHeight(n int) Style {
	return Style{s.Style.MaxHeight(n)}
}

func (s Style) TabWidth(n int) Style {
	return Style{s.Style.TabWidth(n)}
}

func (s Style) UnsetBold() Style {
	return Style{s.Style.UnsetBold()}
}

func (s Style) UnsetItalic() Style {
	return Style{s.Style.UnsetItalic()}
}

func (s Style) UnsetUnderline() Style {
	return Style{s.Style.UnsetUnderline()}
}

func (s Style) UnsetStrikethrough() Style {
	return Style{s.Style.UnsetStrikethrough()}
}

func (s Style) UnsetBlink() Style {
	return Style{s.Style.UnsetBlink()}
}

func (s Style) UnsetFaint() Style {
	return Style{s.Style.UnsetFaint()}
}

func (s Style) UnsetReverse() Style {
	return Style{s.Style.UnsetReverse()}
}

func (s Style) Copy() Style {
	return Style{s.Style}
}

func (s Style) Inherit(i Style) Style {
	return Style{s.Style.Inherit(i.Style)}
}
