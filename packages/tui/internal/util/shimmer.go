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

var shimmerStart = time.Now()

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

	half := 4.0

	type seg struct {
		useHex bool
		hex    string
		bold   bool
		faint  bool
		text   string
	}
	var segs []seg

	useHex := hasTrueColor()
	for i, r := range runes {
		ip := float64(i + pad)
		dist := math.Abs(ip - pos)
		t := 0.0
		if dist <= half {
			x := math.Pi * (dist / half)
			t = 0.5 * (1.0 + math.Cos(x))
		}
		// Cosine brightness: base + amp*t (quantized for grouping)
		base := 0.55
		amp := 0.45
		brightness := base
		if t > 0 {
			brightness = base + amp*t
		}
		lvl := int(math.Round(brightness * 255.0))
		if !useHex {
			step := 24 // ~11 steps across range for non-truecolor
			lvl = int(math.Round(float64(lvl)/float64(step))) * step
		}

		bold := lvl >= 208
		faint := lvl <= 128

		// truecolor if possible; else fallback to modifiers only
		hex := ""
		if useHex {
			if lvl < 0 {
				lvl = 0
			}
			if lvl > 255 {
				lvl = 255
			}
			hex = rgbHex(lvl, lvl, lvl)
		}

		if len(segs) == 0 {
			segs = append(segs, seg{useHex: useHex, hex: hex, bold: bold, faint: faint, text: string(r)})
		} else {
			last := &segs[len(segs)-1]
			if last.useHex == useHex && last.hex == hex && last.bold == bold && last.faint == faint {
				last.text += string(r)
			} else {
				segs = append(segs, seg{useHex: useHex, hex: hex, bold: bold, faint: faint, text: string(r)})
			}
		}
	}

	var b strings.Builder
	for _, g := range segs {
		st := styles.NewStyle().Background(bg)
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
