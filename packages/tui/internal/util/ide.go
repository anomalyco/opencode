package util

import (
	"os"
	"strings"
)

var SUPPORTED_IDES = []struct {
	Search    string
	ShortName string
}{
	{"Windsurf", "Windsurf"},
	{"Visual Studio Code", "vscode"},
	{"Cursor", "Cursor"},
	{"VSCodium", "VSCodium"},
}

func IsVSCode() bool {
	return os.Getenv("OPENCODE_CALLER") == "vscode"
}

func Ide() string {
	for _, ide := range SUPPORTED_IDES {
		if strings.Contains(os.Getenv("GIT_ASKPASS"), ide.Search) {
			return ide.ShortName
		}
	}

	return "unknown"
}

