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
type ThemeSelectedMsg struct{ ThemeName string }
type ThemePreviewMsg struct{ ThemeName string }

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

func (d *themeDialog) Init() tea.Cmd {
	d.setupDialog()
	return d.searchDialog.Init()
}

func (d *themeDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case SearchSelectionMsg:
		if item, ok := msg.Item.(themeItem); ok {
			theme.SetTheme(item.name)
			d.themeApplied = true
			return d, tea.Sequence(
				util.CmdHandler(modal.CloseModalMsg{}),
				util.CmdHandler(ThemeSelectedMsg{ThemeName: item.name}),
			)
		}
		return d, util.CmdHandler(modal.CloseModalMsg{})

	case SearchCancelledMsg:
		return d, util.CmdHandler(modal.CloseModalMsg{})

	case SearchRemoveItemMsg:
		// No recent themes functionality
		return d, nil

	case SearchQueryChangedMsg:
		d.refreshItems()
		d.previewFirstTheme()
		return d, nil

	case SearchSelectionChangedMsg:
		if item, ok := msg.Item.(themeItem); ok {
			theme.SetTheme(item.name)
			return d, util.CmdHandler(ThemePreviewMsg{ThemeName: item.name})
		}
		return d, nil

	case tea.WindowSizeMsg:
		d.searchDialog.SetWidth(dialogWidth)
		d.searchDialog.SetHeight(msg.Height)
	}

	updatedDialog, cmd := d.searchDialog.Update(msg)
	d.searchDialog = updatedDialog.(*SearchDialog)
	return d, cmd
}

func (d *themeDialog) View() string {
	return d.searchDialog.View()
}

func (d *themeDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *themeDialog) Close() tea.Cmd {
	if !d.themeApplied {
		theme.SetTheme(d.originalTheme)
		return util.CmdHandler(ThemeSelectedMsg{ThemeName: d.originalTheme})
	}
	return nil
}

func (d *themeDialog) setupDialog() {
	d.searchDialog = NewSearchDialog("Search themes...", 10)
	d.searchDialog.SetWidth(dialogWidth)
	d.searchDialog.Focus()
	d.refreshItems()
	d.setCurrentThemeSelection()
}

func (d *themeDialog) refreshItems() {
	query := d.searchDialog.GetQuery()
	items := d.buildItems(query)
	d.searchDialog.SetItems(items)
}

func (d *themeDialog) buildItems(query string) []list.Item {
	allThemes := theme.AvailableThemes()

	if query != "" {
		return d.buildSearchItems(query, allThemes)
	}
	return d.buildAllThemes(allThemes)
}

func (d *themeDialog) buildSearchItems(query string, themes []string) []list.Item {
	matches := fuzzy.RankFindFold(query, themes)
	sort.Sort(matches)

	items := make([]list.Item, len(matches))
	for i, match := range matches {
		items[i] = themeItem{name: match.Target}
	}
	return items
}

func (d *themeDialog) buildAllThemes(themes []string) []list.Item {
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

func (d *themeDialog) setCurrentThemeSelection() {
	current := theme.CurrentThemeName()
	items := d.buildItems("")

	for i, item := range items {
		if themeItem, ok := item.(themeItem); ok && themeItem.name == current {
			d.searchDialog.SetSelectedIndex(i)
			break
		}
	}
}

func (d *themeDialog) previewFirstTheme() {
	items := d.buildItems(d.searchDialog.GetQuery())
	for _, item := range items {
		if themeItem, ok := item.(themeItem); ok {
			theme.SetTheme(themeItem.name)
			break
		}
	}
}

// NewThemeDialog creates a new theme selection dialog
func NewThemeDialog(app *app.App) ThemeDialog {
	return &themeDialog{
		app:           app,
		originalTheme: theme.CurrentThemeName(),
		modal:         modal.New(modal.WithTitle("Select Theme"), modal.WithMaxWidth(dialogWidth+4)),
	}
}
