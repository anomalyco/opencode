package completions

import (
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"strings"
)

type historyCompletionProvider struct {
	app *app.App
}

func (h *historyCompletionProvider) GetId() string {
	return "history"
}

func (h *historyCompletionProvider) GetEmptyMessage() string {
	return "no matching history"
}

func (h *historyCompletionProvider) GetChildEntries(query string) ([]CompletionSuggestion, error) {
	return h.GetFilteredChildEntries(query, nil)
}

func (h *historyCompletionProvider) GetFilteredChildEntries(query string, filter func(string) bool) ([]CompletionSuggestion, error) {
	items := make([]CompletionSuggestion, 0)
	query = strings.ToLower(strings.TrimSpace(query))
	seen := make(map[string]struct{})
	for _, prompt := range h.app.State.MessageHistory {
		text := prompt.Text

		// Apply filter if provided
		if filter != nil && !filter(text) {
			continue
		}

		if query != "" && !strings.Contains(strings.ToLower(text), query) {
			continue
		}
		if _, exists := seen[text]; exists {
			continue // Skip duplicate
		}
		seen[text] = struct{}{}
		displayFunc := func(s styles.Style) string {
			return s.Render(text)
		}
		item := CompletionSuggestion{
			Display:    displayFunc,
			Value:      text,
			ProviderID: h.GetId(),
			RawData:    prompt,
		}
		items = append(items, item)
	}
	return items, nil
}

func NewHistoryCompletionProvider(app *app.App) CompletionProvider {
	return &historyCompletionProvider{app: app}
}
