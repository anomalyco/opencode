package styles

import "image/color"

type TerminalInfo struct {
	Background       color.Color
	BackgroundIsDark bool
}

var Terminal *TerminalInfo

func init() {
	Terminal = &TerminalInfo{
		Background:       color.Black,
		BackgroundIsDark: true,
	}
}
