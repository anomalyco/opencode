package input

import (
	"fmt"
	"image/color"
	"math"
)

// ForegroundColorEvent represents a foreground color event. This event is
// emitted when the terminal requests the terminal foreground color using
// [ansi.RequestForegroundColor].
type ForegroundColorEvent struct{ color.Color }

// String returns the hex representation of the color.
func (e ForegroundColorEvent) String() string {
	return colorToHex(e.Color)
}

// IsDark returns whether the color is dark.
func (e ForegroundColorEvent) IsDark() bool {
	return isDarkColor(e.Color)
}

// BackgroundColorEvent represents a background color event. This event is
// emitted when the terminal requests the terminal background color using
// [ansi.RequestBackgroundColor].
type BackgroundColorEvent struct{ color.Color }

// String returns the hex representation of the color.
func (e BackgroundColorEvent) String() string {
	return colorToHex(e)
}

// IsDark returns whether the color is dark.
func (e BackgroundColorEvent) IsDark() bool {
	return isDarkColor(e.Color)
}

// CursorColorEvent represents a cursor color change event. This event is
// emitted when the program requests the terminal cursor color using
// [ansi.RequestCursorColor].
type CursorColorEvent struct{ color.Color }

// String returns the hex representation of the color.
func (e CursorColorEvent) String() string {
	return colorToHex(e)
}

// IsDark returns whether the color is dark.
func (e CursorColorEvent) IsDark() bool {
	return isDarkColor(e)
}

type shiftable interface {
	~uint | ~uint16 | ~uint32 | ~uint64
}

func shift[T shiftable](x T) T {
	if x > 0xff {
		x >>= 8
	}
	return x
}

func colorToHex(c color.Color) string {
	if c == nil {
		return ""
	}
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("#%02x%02x%02x", shift(r), shift(g), shift(b))
}

func getMaxMin(a, b, c float64) (ma, mi float64) {
	if a > b {
		ma = a
		mi = b
	} else {
		ma = b
		mi = a
	}
	if c > ma {
		ma = c
	} else if c < mi {
		mi = c
	}
	return ma, mi
}

func round(x float64) float64 {
	return math.Round(x*1000) / 1000
}

// rgbToHSL converts an RGB triple to an HSL triple.
func rgbToHSL(r, g, b uint8) (h, s, l float64) {
	// convert uint32 pre-multiplied value to uint8
	// The r,g,b values are divided by 255 to change the range from 0..255 to 0..1:
	Rnot := float64(r) / 255
	Gnot := float64(g) / 255
	Bnot := float64(b) / 255
	Cmax, Cmin := getMaxMin(Rnot, Gnot, Bnot)
	Δ := Cmax - Cmin
	// Lightness calculation:
	l = (Cmax + Cmin) / 2
	// Hue and Saturation Calculation:
	if Δ == 0 {
		h = 0
		s = 0
	} else {
		switch Cmax {
		case Rnot:
			h = 60 * (math.Mod((Gnot-Bnot)/Δ, 6))
		case Gnot:
			h = 60 * (((Bnot - Rnot) / Δ) + 2)
		case Bnot:
			h = 60 * (((Rnot - Gnot) / Δ) + 4)
		}
		if h < 0 {
			h += 360
		}

		s = Δ / (1 - math.Abs((2*l)-1))
	}

	return h, round(s), round(l)
}

// isDarkColor returns whether the given color is dark.
func isDarkColor(c color.Color) bool {
	if c == nil {
		return true
	}

	r, g, b, _ := c.RGBA()
	_, _, l := rgbToHSL(uint8(r>>8), uint8(g>>8), uint8(b>>8)) //nolint:gosec
	return l < 0.5
}
