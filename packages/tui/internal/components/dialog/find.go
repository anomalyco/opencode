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

const (
	findDialogWidth = 76
)

type FindSelectedMsg struct {
	FilePath string
}

type FindDialogCloseMsg struct{}

type findInitialSuggestionsMsg struct {
	suggestions []completions.CompletionSuggestion
}

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
	allSuggestions     []completions.CompletionSuggestion
	width, height      int
	modal              *modal.Modal
	searchDialog       *SearchDialog
	dialogWidth        int
}

func (f *findDialogComponent) Init() tea.Cmd {
	return tea.Batch(
		f.loadInitialSuggestions(),
		f.searchDialog.Init(),
	)
}

func (f *findDialogComponent) loadInitialSuggestions() tea.Cmd {
	return func() tea.Msg {
		items, err := f.completionProvider.GetChildEntries("")
		if err != nil {
			slog.Error("Failed to get initial completion items", "error", err)
			return findInitialSuggestionsMsg{suggestions: []completions.CompletionSuggestion{}}
		}
		return findInitialSuggestionsMsg{suggestions: items}
	}
}

func (f *findDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case findInitialSuggestionsMsg:
		// Handle initial suggestions setup
		f.allSuggestions = msg.suggestions

		// Calculate dialog width
		f.dialogWidth = f.calculateDialogWidth()

		// Initialize search dialog with calculated width
		f.searchDialog = NewSearchDialog("Search files...", 10)
		f.searchDialog.SetWidth(f.dialogWidth)

		// Convert to list items
		items := make([]list.Item, len(f.allSuggestions))
		for i, suggestion := range f.allSuggestions {
			items[i] = findItem{suggestion: suggestion}
		}
		f.searchDialog.SetItems(items)

		// Update modal with calculated width
		f.modal = modal.New(
			modal.WithTitle("Find Files"),
			modal.WithMaxWidth(f.dialogWidth+4),
		)

		return f, f.searchDialog.Init()

	case []completions.CompletionSuggestion:
		// Store suggestions and convert to findItem for the search dialog
		f.allSuggestions = msg
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
				return []completions.CompletionSuggestion{}
			}
			return items
		}

	case tea.WindowSizeMsg:
		f.width = msg.Width
		f.height = msg.Height
		// Recalculate width based on new viewport size
		oldWidth := f.dialogWidth
		f.dialogWidth = f.calculateDialogWidth()
		if oldWidth != f.dialogWidth {
			f.searchDialog.SetWidth(f.dialogWidth)
			// Update modal max width too
			f.modal = modal.New(
				modal.WithTitle("Find Files"),
				modal.WithMaxWidth(f.dialogWidth+4),
			)
		}
		f.searchDialog.SetHeight(msg.Height)
	}

	// Forward all other messages to the search dialog
	updatedDialog, cmd := f.searchDialog.Update(msg)
	f.searchDialog = updatedDialog.(*SearchDialog)
	return f, cmd
}

func (f *findDialogComponent) View() string {
	return f.searchDialog.View()
}

func (f *findDialogComponent) calculateDialogWidth() int {
	// Use fixed width unless viewport is smaller
	if f.width > 0 && f.width < findDialogWidth+10 {
		return f.width - 10
	}
	return findDialogWidth
}

func (f *findDialogComponent) SetWidth(width int) {
	f.width = width
	f.searchDialog.SetWidth(f.dialogWidth)
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
	component := &findDialogComponent{
		completionProvider: completionProvider,
		dialogWidth:        findDialogWidth,
		allSuggestions:     []completions.CompletionSuggestion{},
	}

	// Create search dialog and modal with fixed width
	component.searchDialog = NewSearchDialog("Search files...", 10)
	component.searchDialog.SetWidth(findDialogWidth)

	component.modal = modal.New(
		modal.WithTitle("Find Files"),
		modal.WithMaxWidth(findDialogWidth+4),
	)

	return component
}
