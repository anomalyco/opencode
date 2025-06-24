package completions

import (
	"context"

	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/pkg/client"
)

type atFileProvider struct {
	app    *app.App
	prefix string
}

func (af *atFileProvider) GetId() string {
	return af.prefix
}

func (af *atFileProvider) GetEntry() dialog.CompletionItemI {
	return dialog.NewCompletionItem(dialog.CompletionItem{
		Title: "@ Files",
		Value: "@",
	})
}

func (af *atFileProvider) GetEmptyMessage() string {
	return "no matching files"
}

func (af *atFileProvider) getFiles(query string) ([]string, error) {
	response, err := af.app.Client.PostFileSearchWithResponse(context.Background(), client.PostFileSearchJSONRequestBody{
		Query: query,
	})
	if err != nil {
		return []string{}, err
	}
	if response.JSON200 == nil {
		return []string{}, nil
	}

	return *response.JSON200, nil
}

func (af *atFileProvider) GetChildEntries(query string) ([]dialog.CompletionItemI, error) {
	matches, err := af.getFiles(query)
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

func NewAtFileProvider(app *app.App) dialog.CompletionProvider {
	return &atFileProvider{
		app:    app,
		prefix: "@",
	}
}