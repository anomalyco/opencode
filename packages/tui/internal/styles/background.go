package styles

type TerminalInfo struct {
	BackgroundIsDark bool
}

var Terminal *TerminalInfo

func init() {
	Terminal = &TerminalInfo{
		BackgroundIsDark: true,
	}
}
