package layout

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	chAnsi "github.com/charmbracelet/x/ansi"
	"github.com/muesli/ansi"
	"github.com/muesli/reflow/truncate"
	"github.com/muesli/termenv"
	"github.com/sst/opencode/internal/util"
)

var (
	// ANSI escape sequence regex
	ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*m`)
)

// Split a string into lines, additionally returning the size of the widest line.
func getLines(s string) (lines []string, widest int) {
	lines = strings.Split(s, "\n")
	for _, l := range lines {
		w := ansi.PrintableRuneWidth(l)
		if widest < w {
			widest = w
		}
	}
	return lines, widest
}

// overlayOptions holds configuration for overlay rendering
type overlayOptions struct {
	whitespace  *whitespace
	border      bool
	borderColor *compat.AdaptiveColor
}

// OverlayOption sets options for overlay rendering
type OverlayOption func(*overlayOptions)

// PlaceOverlay places fg on top of bg.
func PlaceOverlay(
	x, y int,
	fg, bg string,
	opts ...OverlayOption,
) string {
	fgLines, fgWidth := getLines(fg)
	bgLines, bgWidth := getLines(bg)
	bgHeight := len(bgLines)
	fgHeight := len(fgLines)

	// Parse options
	options := &overlayOptions{
		whitespace: &whitespace{},
	}
	for _, opt := range opts {
		opt(options)
	}

	// Adjust for borders if enabled
	if options.border {
		// Add space for left and right borders
		adjustedFgWidth := fgWidth + 2
		// Adjust placement to account for borders
		x = util.Clamp(x, 0, bgWidth-adjustedFgWidth)
		y = util.Clamp(y, 0, bgHeight-fgHeight)

		// Pad all foreground lines to the same width for consistent borders
		for i := range fgLines {
			lineWidth := ansi.PrintableRuneWidth(fgLines[i])
			if lineWidth < fgWidth {
				fgLines[i] += strings.Repeat(" ", fgWidth-lineWidth)
			}
		}
	} else {
		if fgWidth >= bgWidth && fgHeight >= bgHeight {
			// FIXME: return fg or bg?
			return fg
		}
		// TODO: allow placement outside of the bg box?
		x = util.Clamp(x, 0, bgWidth-fgWidth)
		y = util.Clamp(y, 0, bgHeight-fgHeight)
	}

	var b strings.Builder
	for i, bgLine := range bgLines {
		if i > 0 {
			b.WriteByte('\n')
		}
		if i < y || i >= y+fgHeight {
			b.WriteString(bgLine)
			continue
		}

		pos := 0

		// Handle left side of the line up to the overlay
		if x > 0 {
			left := truncate.String(bgLine, uint(x))
			pos = ansi.PrintableRuneWidth(left)
			b.WriteString(left)
			if pos < x {
				b.WriteString(options.whitespace.render(x - pos))
				pos = x
			}
		}

		// Render the overlay content with optional borders
		if options.border {
			// Get the foreground line
			fgLine := fgLines[i-y]
			fgLineWidth := ansi.PrintableRuneWidth(fgLine)

			// Extract the styles at the border positions
			// We need to get the style just before the border position to preserve background
			leftStyle := ansiStyle{}
			if pos > 0 {
				leftStyle = getStyleAtPosition(bgLine, pos-1)
			} else {
				leftStyle = getStyleAtPosition(bgLine, pos)
			}
			rightStyle := getStyleAtPosition(bgLine, pos+fgLineWidth)

			// Left border - combine background from original with border foreground
			leftSeq := combineStyles(leftStyle, options.borderColor)
			if leftSeq != "" {
				b.WriteString(leftSeq)
			}
			b.WriteString("┃")
			if leftSeq != "" {
				b.WriteString("\x1b[0m") // Reset all styles only if we applied any
			}
			pos++

			// Content
			b.WriteString(fgLine)
			pos += fgLineWidth

			// Right border - combine background from original with border foreground
			rightSeq := combineStyles(rightStyle, options.borderColor)
			if rightSeq != "" {
				b.WriteString(rightSeq)
			}
			b.WriteString("┃")
			if rightSeq != "" {
				b.WriteString("\x1b[0m") // Reset all styles only if we applied any
			}
			pos++
		} else {
			// No border, just render the content
			fgLine := fgLines[i-y]
			b.WriteString(fgLine)
			pos += ansi.PrintableRuneWidth(fgLine)
		}

		// Handle right side of the line after the overlay
		right := cutLeft(bgLine, pos)
		bgWidth := ansi.PrintableRuneWidth(bgLine)
		rightWidth := ansi.PrintableRuneWidth(right)
		if rightWidth <= bgWidth-pos {
			b.WriteString(options.whitespace.render(bgWidth - rightWidth - pos))
		}

		b.WriteString(right)
	}

	return b.String()
}

// cutLeft cuts printable characters from the left.
// This function is heavily based on muesli's ansi and truncate packages.
func cutLeft(s string, cutWidth int) string {
	return chAnsi.Cut(s, cutWidth, lipgloss.Width(s))
}

// ansiStyle represents parsed ANSI style attributes
type ansiStyle struct {
	fgColor string
	bgColor string
	attrs   []string
}

// parseANSISequence parses an ANSI escape sequence into its components
func parseANSISequence(seq string) ansiStyle {
	style := ansiStyle{}

	// Extract the parameters from the sequence (e.g., \x1b[38;5;123;48;5;456m -> "38;5;123;48;5;456")
	if !strings.HasPrefix(seq, "\x1b[") || !strings.HasSuffix(seq, "m") {
		return style
	}

	params := seq[2 : len(seq)-1]
	if params == "" {
		return style
	}

	parts := strings.Split(params, ";")
	i := 0
	for i < len(parts) {
		switch parts[i] {
		case "0": // Reset
			// Mark this as a reset by adding it to attrs
			style.attrs = append(style.attrs, "0")
			// Don't clear the style here, let the caller handle it
		case "1", "2", "3", "4", "5", "6", "7", "8", "9": // Various attributes
			style.attrs = append(style.attrs, parts[i])
		case "38": // Foreground color
			if i+1 < len(parts) && parts[i+1] == "5" && i+2 < len(parts) {
				// 256 color mode
				style.fgColor = strings.Join(parts[i:i+3], ";")
				i += 2
			} else if i+1 < len(parts) && parts[i+1] == "2" && i+4 < len(parts) {
				// RGB color mode
				style.fgColor = strings.Join(parts[i:i+5], ";")
				i += 4
			}
		case "48": // Background color
			if i+1 < len(parts) && parts[i+1] == "5" && i+2 < len(parts) {
				// 256 color mode
				style.bgColor = strings.Join(parts[i:i+3], ";")
				i += 2
			} else if i+1 < len(parts) && parts[i+1] == "2" && i+4 < len(parts) {
				// RGB color mode
				style.bgColor = strings.Join(parts[i:i+5], ";")
				i += 4
			}
		case "30", "31", "32", "33", "34", "35", "36", "37": // Standard foreground colors
			style.fgColor = parts[i]
		case "40", "41", "42", "43", "44", "45", "46", "47": // Standard background colors
			style.bgColor = parts[i]
		case "90", "91", "92", "93", "94", "95", "96", "97": // Bright foreground colors
			style.fgColor = parts[i]
		case "100", "101", "102", "103", "104", "105", "106", "107": // Bright background colors
			style.bgColor = parts[i]
		}
		i++
	}

	return style
}

// combineStyles creates an ANSI sequence that combines background from one style with foreground from another
func combineStyles(bgStyle ansiStyle, fgColor *compat.AdaptiveColor) string {
	if fgColor == nil && bgStyle.bgColor == "" && len(bgStyle.attrs) == 0 {
		return ""
	}

	var parts []string

	// Add attributes
	parts = append(parts, bgStyle.attrs...)

	// Add background color from the original style
	if bgStyle.bgColor != "" {
		parts = append(parts, bgStyle.bgColor)
	}

	// Add foreground color if specified
	if fgColor != nil {
		// Use the adaptive color which automatically selects based on terminal background
		// The RGBA method already handles light/dark selection
		r, g, b, _ := fgColor.RGBA()
		// RGBA returns 16-bit values, we need 8-bit
		parts = append(parts, fmt.Sprintf("38;2;%d;%d;%d", r>>8, g>>8, b>>8))
	}

	if len(parts) == 0 {
		return ""
	}

	return fmt.Sprintf("\x1b[%sm", strings.Join(parts, ";"))
}

// getStyleAtPosition extracts the active ANSI style at a given visual position
func getStyleAtPosition(s string, targetPos int) ansiStyle {
	visualPos := 0
	currentStyle := ansiStyle{}

	i := 0
	for i < len(s) && visualPos <= targetPos {
		// Check if we're at an ANSI escape sequence
		if match := ansiRegex.FindStringIndex(s[i:]); match != nil && match[0] == 0 {
			// Found an ANSI sequence at current position
			seq := s[i : i+match[1]]
			parsedStyle := parseANSISequence(seq)

			// Check if this is a reset sequence
			if len(parsedStyle.attrs) > 0 && parsedStyle.attrs[0] == "0" {
				// Reset all styles
				currentStyle = ansiStyle{}
			} else {
				// Update current style (merge with existing)
				if parsedStyle.fgColor != "" {
					currentStyle.fgColor = parsedStyle.fgColor
				}
				if parsedStyle.bgColor != "" {
					currentStyle.bgColor = parsedStyle.bgColor
				}
				if len(parsedStyle.attrs) > 0 {
					currentStyle.attrs = parsedStyle.attrs
				}
			}

			i += match[1]
		} else if i < len(s) {
			// Regular character
			if visualPos == targetPos {
				return currentStyle
			}
			_, size := utf8.DecodeRuneInString(s[i:])
			i += size
			visualPos++
		}
	}

	return currentStyle
}

type whitespace struct {
	style termenv.Style
	chars string
}

// Render whitespaces.
func (w whitespace) render(width int) string {
	if w.chars == "" {
		w.chars = " "
	}

	r := []rune(w.chars)
	j := 0
	b := strings.Builder{}

	// Cycle through runes and print them into the whitespace.
	for i := 0; i < width; {
		b.WriteRune(r[j])
		j++
		if j >= len(r) {
			j = 0
		}
		i += ansi.PrintableRuneWidth(string(r[j]))
	}

	// Fill any extra gaps white spaces. This might be necessary if any runes
	// are more than one cell wide, which could leave a one-rune gap.
	short := width - ansi.PrintableRuneWidth(b.String())
	if short > 0 {
		b.WriteString(strings.Repeat(" ", short))
	}

	return w.style.Styled(b.String())
}

// WhitespaceOption sets a styling rule for rendering whitespace.
type WhitespaceOption func(*whitespace)

// WithWhitespace sets whitespace options for the overlay
func WithWhitespace(opts ...WhitespaceOption) OverlayOption {
	return func(o *overlayOptions) {
		for _, opt := range opts {
			opt(o.whitespace)
		}
	}
}

// WithOverlayBorder enables border rendering for the overlay
func WithOverlayBorder() OverlayOption {
	return func(o *overlayOptions) {
		o.border = true
	}
}

// WithOverlayBorderColor sets the border color for the overlay
func WithOverlayBorderColor(color compat.AdaptiveColor) OverlayOption {
	return func(o *overlayOptions) {
		o.borderColor = &color
	}
}
