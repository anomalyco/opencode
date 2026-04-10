package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "help", "-h", "--help":
			fmt.Print(helpText())
			return
		case "version", "-v", "--version":
			fmt.Println("OpenCode Go stub: use the JavaScript CLI or desktop app for full functionality.")
			return
		}
	}

	fmt.Print(helpText())
}

func helpText() string {
	return `OpenCode is now distributed as a JavaScript CLI and desktop application.

To install the full OpenCode CLI, use one of these installers:
  npm install -g opencode-ai@latest
  brew install anomalyco/tap/opencode
  curl -fsSL https://opencode.ai/install | bash

This Go stub exists to make:
  go install github.com/sst/opencode@latest

succeed and provide guidance for the full install path.
`
}
