package completions

import (
	"context"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
)

type filesAndFoldersContextGroup struct {
	app    *app.App
	prefix string
}

func (cg *filesAndFoldersContextGroup) GetId() string {
	return cg.prefix
}

func (cg *filesAndFoldersContextGroup) GetEntry() dialog.CompletionItemI {
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: "Files & Folders",
		Value: "files",
	})
}

func (cg *filesAndFoldersContextGroup) GetEmptyMessage() string {
	return "no matching files"
}

func (cg *filesAndFoldersContextGroup) getFiles(query string) ([]string, error) {
	files, err := cg.app.Client.File.Search(
		context.Background(),
		opencode.FileSearchParams{Query: opencode.F(query)},
	)
	if err != nil {
		return []string{}, err
	}
	return *files, nil
}

func (cg *filesAndFoldersContextGroup) GetChildEntries(query string) ([]dialog.CompletionItemI, error) {
	matches, err := cg.getFiles(query)
	if err != nil {
		return nil, err
	}

	items := make([]dialog.CompletionItemI, 0, len(matches))
	for _, file := range matches {
		item := dialog.NewCompletionItem(dialog.CompletionItem{
			Title: file,
			Value: file,
		})
		items = append(items, item)
	}

	return items, nil
}

func NewFileAndFolderContextGroup(app *app.App) dialog.CompletionProvider {
	return &filesAndFoldersContextGroup{
		app:    app,
		prefix: "file",
	}
}
