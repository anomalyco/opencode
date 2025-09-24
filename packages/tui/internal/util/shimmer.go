package util

import (
	"math"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/styles"
)

var (
	shimmerStart     = time.Now()
	trueColorSupport = hasTrueColor()
)

// Shimmer renders text with a moving foreground highlight.
// bg is the background color, dim is the base text color, bright is the highlight color.
func Shimmer(s string, bg compat.AdaptiveColor, _ compat.AdaptiveColor, _ compat.AdaptiveColor) string {
	if s == "" {
		return ""
	}

	runes := []rune(s)
	n := len(runes)
	if n == 0 {
		return s
	}

	pad := 10
	period := float64(n + pad*2)
	sweep := 2.5
	elapsed := time.Since(shimmerStart).Seconds()
	pos := (math.Mod(elapsed, sweep) / sweep) * period

	half := 2.0

	type seg struct {
		useHex bool
		hex    string
		bold   bool
		faint  bool
		text   string
	}
	segs := make([]seg, 0, n/4)

	useHex := trueColorSupport
	for i, r := range runes {
		ip := float64(i + pad)
		dist := math.Abs(ip - pos)

		bold := false
		faint := true
		hex := ""

		if dist <= half {
			// Simple 3-level brightness based on distance
			if dist <= half/3 {
				// Center: brightest
				bold = true
				faint = false
				if useHex {
					hex = "#ffffff"
				}
			} else {
				// Edge: medium bright
				bold = false
				faint = false
				if useHex {
					hex = "#cccccc"
				}
			}
		}

		if len(segs) == 0 ||
			segs[len(segs)-1].useHex != useHex ||
			segs[len(segs)-1].hex != hex ||
			segs[len(segs)-1].bold != bold ||
			segs[len(segs)-1].faint != faint {
			segs = append(segs, seg{useHex: useHex, hex: hex, bold: bold, faint: faint, text: string(r)})
		} else {
			segs[len(segs)-1].text += string(r)
		}
	}

	baseStyle := styles.NewStyle().Background(bg)
	var b strings.Builder
	b.Grow(len(s) * 2)
	for _, g := range segs {
		st := baseStyle
		if g.useHex && g.hex != "" {
			c := compat.AdaptiveColor{Dark: lipgloss.Color(g.hex), Light: lipgloss.Color(g.hex)}
			st = st.Foreground(c)
		}
		if g.bold {
			st = st.Bold(true)
		}
		if g.faint {
			st = st.Faint(true)
		}
		b.WriteString(st.Render(g.text))
	}
	return b.String()
}

func hasTrueColor() bool {
	c := strings.ToLower(os.Getenv("COLORTERM"))
	return strings.Contains(c, "truecolor") || strings.Contains(c, "24bit")
}

func rgbHex(r, g, b int) string {
	if r < 0 {
		r = 0
	}
	if r > 255 {
		r = 255
	}
	if g < 0 {
		g = 0
	}
	if g > 255 {
		g = 255
	}
	if b < 0 {
		b = 0
	}
	if b > 255 {
		b = 255
	}
	return "#" + hex2(r) + hex2(g) + hex2(b)
}

func hex2(v int) string {
	const digits = "0123456789abcdef"
	return string([]byte{digits[(v>>4)&0xF], digits[v&0xF]})
}
