package util

import (
	"regexp"
	"strings"

	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/theme"
)

var csiRE *regexp.Regexp

func init() {
	csiRE = regexp.MustCompile(`\x1b\[([0-9;]+)m`)
}

var targetFGMap = map[string]string{
	"0;0;0":       "\x1b[30m", // Black
	"128;0;0":     "\x1b[31m", // Red
	"0;128;0":     "\x1b[32m", // Green
	"128;128;0":   "\x1b[33m", // Yellow
	"0;0;128":     "\x1b[34m", // Blue
	"128;0;128":   "\x1b[35m", // Magenta
	"0;128;128":   "\x1b[36m", // Cyan
	"192;192;192": "\x1b[37m", // White (light grey)
	"128;128;128": "\x1b[90m", // Bright Black (dark grey)
	"255;0;0":     "\x1b[91m", // Bright Red
	"0;255;0":     "\x1b[92m", // Bright Green
	"255;255;0":   "\x1b[93m", // Bright Yellow
	"0;0;255":     "\x1b[94m", // Bright Blue
	"255;0;255":   "\x1b[95m", // Bright Magenta
	"0;255;255":   "\x1b[96m", // Bright Cyan
	"255;255;255": "\x1b[97m", // Bright White
}

var targetBGMap = map[string]string{
	"0;0;0":       "\x1b[40m",
	"128;0;0":     "\x1b[41m",
	"0;128;0":     "\x1b[42m",
	"128;128;0":   "\x1b[43m",
	"0;0;128":     "\x1b[44m",
	"128;0;128":   "\x1b[45m",
	"0;128;128":   "\x1b[46m",
	"192;192;192": "\x1b[47m",
	"128;128;128": "\x1b[100m",
	"255;0;0":     "\x1b[101m",
	"0;255;0":     "\x1b[102m",
	"255;255;0":   "\x1b[103m",
	"0;0;255":     "\x1b[104m",
	"255;0;255":   "\x1b[105m",
	"0;255;255":   "\x1b[106m",
	"255;255;255": "\x1b[107m",
}

func ConvertRGBToAnsi16Colors(s string) string {
	return csiRE.ReplaceAllStringFunc(s, func(seq string) string {
		params := strings.Split(csiRE.FindStringSubmatch(seq)[1], ";")
		out := make([]string, 0, len(params))

		for i := 0; i < len(params); {
			// Detect “38 | 48 ; 2 ; r ; g ; b ( ; alpha? )”
			if (params[i] == "38" || params[i] == "48") &&
				i+4 < len(params) &&
				params[i+1] == "2" {

				key := strings.Join(params[i+2:i+5], ";")
				var repl string
				if params[i] == "38" {
					repl = targetFGMap[key]
				} else {
					repl = targetBGMap[key]
				}

				if repl != "" { // exact RGB hit
					out = append(out, repl[2:len(repl)-1])
					i += 5 // skip 38/48;2;r;g;b

					// if i == len(params)-1 && looksLikeByte(params[i]) {
					// 	i++ // swallow the alpha byte
					// }
					continue
				}
			}
			// Normal token — keep verbatim.
			out = append(out, params[i])
			i++
		}

		return "\x1b[" + strings.Join(out, ";") + "m"
	})
}

// func looksLikeByte(tok string) bool {
// 	v, err := strconv.Atoi(tok)
//   return err == nil && v >= 0 && v <= 255
// }

// GetAgentColor returns the color for a given agent index, matching the status bar colors
func GetAgentColor(agentIndex int) compat.AdaptiveColor {
	t := theme.CurrentTheme()
	agentColors := []compat.AdaptiveColor{
		t.TextMuted(),
		t.Secondary(),
		t.Accent(),
		t.Success(),
		t.Warning(),
		t.Primary(),
		t.Error(),
	}

	if agentIndex >= 0 && agentIndex < len(agentColors) {
		return agentColors[agentIndex]
	}
	return t.Secondary() // default fallback
}
