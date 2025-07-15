package dialog

import (
	"log/slog"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
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

type findDialogComponent struct {
	completionProvider CompletionProvider
	width, height      int
	modal              *modal.Modal
	searchDialog       *SearchDialog
}

func (f *findDialogComponent) Init() tea.Cmd {
	return f.searchDialog.Init()
}

func (f *findDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case []CompletionItemI:
		// Convert CompletionItemI to list.ListItem
		items := make([]list.ListItem, len(msg))
		for i, item := range msg {
			items[i] = item
		}
		f.searchDialog.SetItems(items)
		return f, nil

	case SearchSelectionMsg:
		// Handle selection from search dialog
		if item, ok := msg.Item.(CompletionItemI); ok {
			return f, f.selectFile(item)
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

func (f *findDialogComponent) selectFile(item CompletionItemI) tea.Cmd {
	return tea.Sequence(
		f.Close(),
		util.CmdHandler(FindSelectedMsg{
			FilePath: item.GetValue(),
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

func NewFindDialog(completionProvider CompletionProvider) FindDialog {
	searchDialog := NewSearchDialog("Search files...", 10)

	// Initialize with empty query to get initial items
	go func() {
		items, err := completionProvider.GetChildEntries("")
		if err != nil {
			slog.Error("Failed to get completion items", "error", err)
			return
		}
		// Convert CompletionItemI to list.ListItem
		listItems := make([]list.ListItem, len(items))
		for i, item := range items {
			listItems[i] = item
		}
		searchDialog.SetItems(listItems)
	}()

	return &findDialogComponent{
		completionProvider: completionProvider,
		searchDialog:       searchDialog,
		modal: modal.New(
			modal.WithTitle("Find Files"),
			modal.WithMaxWidth(80),
		),
	}
}
