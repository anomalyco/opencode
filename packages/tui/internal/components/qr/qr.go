package qr

import (
	"strings"

	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"rsc.io/qr"
)

var tops_bottoms = []rune{' ', '▀', '▄', '█'}

// Generate a text string to a QR code, which you can write to a terminal or file.
func Generate(text string) (string, int, error) {
	code, err := qr.Encode(text, qr.Level(0))
	if err != nil {
		return "", 0, err
	}

	t := theme.CurrentTheme()
	if t == nil {
		return "", 0, err
	}

	// Create lipgloss style for QR code with theme colors
	qrStyle := styles.NewStyle().Foreground(t.Text()).Background(t.Background())

	var result strings.Builder

	// content
	for y := 0; y < code.Size-1; y += 2 {
		var line strings.Builder
		for x := 0; x < code.Size; x += 1 {
			var num int8
			if code.Black(x, y) {
				num += 1
			}
			if code.Black(x, y+1) {
				num += 2
			}
			line.WriteRune(tops_bottoms[num])
		}
		result.WriteString(qrStyle.Render(line.String()) + "\n")
	}

	// add lower border when required (only required when QR size is odd)
	if code.Size%2 == 1 {
		var borderLine strings.Builder
		for range code.Size {
			borderLine.WriteRune('▀')
		}
		result.WriteString(qrStyle.Render(borderLine.String()) + "\n")
	}

	return result.String(), code.Size, nil
}
