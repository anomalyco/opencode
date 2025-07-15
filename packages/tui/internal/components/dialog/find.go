package dialog

import (
	"log/slog"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/completions"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type FindSelectedMsg struct {
	FilePath string
}

type FindDialogCloseMsg struct{}

type FindDialog interface {
	layout.Modal
	tea.Model
	tea.ViewModel
	SetWidth(width int)
	SetHeight(height int)
	IsEmpty() bool
}

// findItem is a custom list item for file suggestions
type findItem struct {
	suggestion completions.CompletionSuggestion
}

func (f findItem) Render(
	selected bool,
	width int,
	baseStyle styles.Style,
) string {
	t := theme.CurrentTheme()

	itemStyle := baseStyle.
		Background(t.BackgroundPanel()).
		Foreground(t.TextMuted())

	if selected {
		itemStyle = itemStyle.Foreground(t.Primary())
	}

	return itemStyle.PaddingLeft(1).Render(f.suggestion.Display(itemStyle))
}

func (f findItem) Selectable() bool {
	return true
}

type findDialogComponent struct {
	completionProvider completions.CompletionProvider
	width, height      int
	modal              *modal.Modal
	searchDialog       *SearchDialog
	suggestions        []completions.CompletionSuggestion
}

func (f *findDialogComponent) Init() tea.Cmd {
	return f.searchDialog.Init()
}

func (f *findDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case []completions.CompletionSuggestion:
		// Store suggestions and convert to findItem for the search dialog
		f.suggestions = msg
		items := make([]list.Item, len(msg))
		for i, suggestion := range msg {
			items[i] = findItem{suggestion: suggestion}
		}
		f.searchDialog.SetItems(items)
		return f, nil

	case SearchSelectionMsg:
		// Handle selection from search dialog - now we can directly access the suggestion
		if item, ok := msg.Item.(findItem); ok {
			return f, f.selectFile(item.suggestion)
		}
		return f, nil

	case SearchCancelledMsg:
		return f, f.Close()

	case SearchQueryChangedMsg:
		// Update completion items based on search query
		return f, func() tea.Msg {
			items, err := f.completionProvider.GetChildEntries(msg.Query)
			if err != nil {
				slog.Error("Failed to get completion items", "error", err)
			}
			return items
		}
	}

	// Forward all other messages to the search dialog
	updatedDialog, cmd := f.searchDialog.Update(msg)
	f.searchDialog = updatedDialog.(*SearchDialog)
	return f, cmd
}

func (f *findDialogComponent) View() string {
	return f.searchDialog.View()
}

func (f *findDialogComponent) SetWidth(width int) {
	f.width = width
	f.searchDialog.SetWidth(width - 4)
}

func (f *findDialogComponent) SetHeight(height int) {
	f.height = height
}

func (f *findDialogComponent) IsEmpty() bool {
	return f.searchDialog.GetQuery() == ""
}

func (f *findDialogComponent) selectFile(item completions.CompletionSuggestion) tea.Cmd {
	return tea.Sequence(
		f.Close(),
		util.CmdHandler(FindSelectedMsg{
			FilePath: item.Value,
		}),
	)
}

func (f *findDialogComponent) Render(background string) string {
	return f.modal.Render(f.View(), background)
}

func (f *findDialogComponent) Close() tea.Cmd {
	f.searchDialog.SetQuery("")
	f.searchDialog.Blur()
	return util.CmdHandler(modal.CloseModalMsg{})
}

func NewFindDialog(completionProvider completions.CompletionProvider) FindDialog {
	searchDialog := NewSearchDialog("Search files...", 10)

	component := &findDialogComponent{
		completionProvider: completionProvider,
		searchDialog:       searchDialog,
		suggestions:        []completions.CompletionSuggestion{},
		modal: modal.New(
			modal.WithTitle("Find Files"),
			modal.WithMaxWidth(80),
		),
	}

	// Initialize with empty query to get initial items
	go func() {
		items, err := completionProvider.GetChildEntries("")
		if err != nil {
			slog.Error("Failed to get completion items", "error", err)
			return
		}
		// Store suggestions and convert to findItem
		component.suggestions = items
		listItems := make([]list.Item, len(items))
		for i, item := range items {
			listItems[i] = findItem{suggestion: item}
		}
		searchDialog.SetItems(listItems)
	}()

	return component
}
