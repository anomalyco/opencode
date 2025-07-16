package dialog

import (
	"sort"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/lithammer/fuzzysearch/fuzzy"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

const dialogWidth = 50

// Theme messages
type (
	ThemeSelectedMsg struct{ ThemeName string }
	ThemePreviewMsg  struct{ ThemeName string }
)

type ThemeDialog interface {
	layout.Modal
}

type themeDialog struct {
	app           *app.App
	modal         *modal.Modal
	searchDialog  *SearchDialog
	originalTheme string
	themeApplied  bool
}

type themeItem struct {
	name string
}

func (t themeItem) Render(selected bool, width int, baseStyle styles.Style) string {
	currentTheme := theme.CurrentTheme()
	style := baseStyle.Background(currentTheme.BackgroundPanel()).Foreground(currentTheme.Text())
	if selected {
		style = style.Foreground(currentTheme.Primary())
	}
	return style.PaddingLeft(1).Render(t.name)
}

func (t themeItem) Selectable() bool { return true }

func (t *themeDialog) Init() tea.Cmd {
	t.setupDialog()
	return t.searchDialog.Init()
}

func (t *themeDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case SearchSelectionMsg:
		if item, ok := msg.Item.(themeItem); ok {
			theme.SetTheme(item.name)
			t.themeApplied = true
			return t, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(ThemeSelectedMsg{ThemeName: item.name}),
			)
		}
		return t, util.CmdHandler(modal.CloseModalMsg{})

	case SearchCancelledMsg:
		return t, util.CmdHandler(modal.CloseModalMsg{})

	case SearchRemoveItemMsg:
		// No recent themes functionality
		return t, nil

	case SearchQueryChangedMsg:
		t.refreshItems()
		t.previewFirstTheme()
		return t, nil

	case SearchSelectionChangedMsg:
		if item, ok := msg.Item.(themeItem); ok {
			theme.SetTheme(item.name)
			return t, util.CmdHandler(ThemePreviewMsg{ThemeName: item.name})
		}
		return t, nil

	case tea.WindowSizeMsg:
		t.searchDialog.SetWidth(dialogWidth)
		t.searchDialog.SetHeight(msg.Height)
	}

	updatedDialog, cmd := t.searchDialog.Update(msg)
	t.searchDialog = updatedDialog.(*SearchDialog)
	return t, cmd
}

func (t *themeDialog) View() string {
	return t.searchDialog.View()
}

func (t *themeDialog) Render(background string) string {
	return t.modal.Render(t.View(), background)
}

func (t *themeDialog) Close() tea.Cmd {
	if !t.themeApplied {
		theme.SetTheme(t.originalTheme)
		return util.CmdHandler(ThemeSelectedMsg{ThemeName: t.originalTheme})
	}
	return nil
}

func (t *themeDialog) setupDialog() {
	t.searchDialog = NewSearchDialog("Search themes...", 10)
	t.searchDialog.SetWidth(dialogWidth)
	t.searchDialog.Focus()
	t.refreshItems()
	t.setCurrentThemeSelection()
}

func (t *themeDialog) refreshItems() {
	query := t.searchDialog.GetQuery()
	items := t.buildItems(query)
	t.searchDialog.SetItems(items)
}

func (t *themeDialog) buildItems(query string) []list.Item {
	allThemes := theme.AvailableThemes()

	if query != "" {
		return t.buildSearchItems(query, allThemes)
	}
	return t.buildAllThemes(allThemes)
}

func (t *themeDialog) buildSearchItems(query string, themes []string) []list.Item {
	matches := fuzzy.RankFindFold(query, themes)
	sort.Sort(matches)

	items := make([]list.Item, len(matches))
	for i, match := range matches {
		items[i] = themeItem{name: match.Target}
	}
	return items
}

func (t *themeDialog) buildAllThemes(themes []string) []list.Item {
	var items []list.Item

	// Sort themes alphabetically
	sorted := make([]string, len(themes))
	copy(sorted, themes)
	sort.Strings(sorted)

	for _, name := range sorted {
		items = append(items, themeItem{name: name})
	}

	return items
}

func (t *themeDialog) setCurrentThemeSelection() {
	current := theme.CurrentThemeName()
	items := t.buildItems("")

	for i, item := range items {
		if themeItem, ok := item.(themeItem); ok && themeItem.name == current {
			t.searchDialog.SetSelectedIndex(i)
			break
		}
	}
}

func (t *themeDialog) previewFirstTheme() {
	items := t.buildItems(t.searchDialog.GetQuery())
	for _, item := range items {
		if themeItem, ok := item.(themeItem); ok {
			theme.SetTheme(themeItem.name)
			break
		}
	}
}

// NewThemeDialog creates a new theme selection dialog
func NewThemeDialog(app *app.App) ThemeDialog {
	dialog := &themeDialog{
		app:           app,
		originalTheme: theme.CurrentThemeName(),
		modal:         modal.New(modal.WithTitle("Select Theme"), modal.WithMaxWidth(dialogWidth+4)),
	}

	dialog.setupDialog()

	return dialog
}
