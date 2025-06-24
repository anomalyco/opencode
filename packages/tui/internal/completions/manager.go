package completions

import (
	"strings"

	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
)

type CompletionManager struct {
	providers map[string]dialog.CompletionProvider
}

func NewCompletionManager(app *app.App) *CompletionManager {
	return &CompletionManager{
		providers: map[string]dialog.CompletionProvider{
			"files":    NewFileAndFolderContextGroup(app),
			"commands": NewCommandCompletionProvider(app),
			"at-files": NewAtFileProvider(app),
		},
	}
}

func (m *CompletionManager) DefaultProvider() dialog.CompletionProvider {
	return m.providers["commands"]
}

func (m *CompletionManager) GetProvider(input string) dialog.CompletionProvider {
	if strings.HasPrefix(input, "/") {
		return m.providers["commands"]
	}
	if strings.HasPrefix(input, "@") {
		return m.providers["at-files"]
	}
	return m.providers["files"]
}
