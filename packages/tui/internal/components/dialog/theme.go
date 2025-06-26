package dialog

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	list "github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// ThemeSelectedMsg is sent when the theme is changed
type ThemeSelectedMsg struct {
	ThemeName string
}

// ThemeDialog interface for the theme switching dialog
type ThemeDialog interface {
	layout.Modal
}

type themeDialog struct {
	width  int
	height int

	modal         *modal.Modal
	list          list.List[list.StringItem]
	originalTheme string
	themeApplied  bool
}

func (t *themeDialog) Init() tea.Cmd {
	return nil
}

func (t *themeDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		t.width = msg.Width
		t.height = msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "enter":
			if item, idx := t.list.GetSelectedItem(); idx >= 0 {
				selectedTheme := string(item)
				if err := theme.SetTheme(selectedTheme); err != nil {
					// status.Error(err.Error())
					return t, nil
				}
				t.themeApplied = true
				return t, tea.Sequence(
					util.CmdHandler(modal.CloseModalMsg{}),
					util.CmdHandler(ThemeSelectedMsg{ThemeName: selectedTheme}),
				)
			}

		}
	}

	_, prevIdx := t.list.GetSelectedItem()

	var cmd tea.Cmd
	listModel, cmd := t.list.Update(msg)
	t.list = listModel.(list.List[list.StringItem])

	if item, newIdx := t.list.GetSelectedItem(); newIdx >= 0 && newIdx != prevIdx {
		theme.SetTheme(string(item))
		return t, util.CmdHandler(ThemeSelectedMsg{ThemeName: string(item)})
	}
	return t, cmd
}

func (t *themeDialog) Render(background string) string {
	return t.modal.Render(t.list.View(), background)
}

func (t *themeDialog) Close() tea.Cmd {
	if !t.themeApplied {
		theme.SetTheme(t.originalTheme)
		return util.CmdHandler(ThemeSelectedMsg{ThemeName: t.originalTheme})
	}
	return nil
}

// NewThemeDialog creates a new theme switching dialog
func NewThemeDialog() ThemeDialog {
	themes := theme.AvailableThemes()
	currentTheme := theme.CurrentThemeName()

	var selectedIdx int
	for i, name := range themes {
		if name == currentTheme {
			selectedIdx = i
		}
	}

	list := list.NewStringList(
		themes,
		10, // maxVisibleThemes
		"No themes available",
		true,
	)

	// Set the initial selection to the current theme
	list.SetSelectedIndex(selectedIdx)

	// Set the max width for the list to match the modal width
	list.SetMaxWidth(36) // 40 (modal max width) - 4 (modal padding)

	return &themeDialog{
		list:          list,
		modal:         modal.New(modal.WithTitle("Select Theme"), modal.WithMaxWidth(40)),
		originalTheme: currentTheme,
		themeApplied:  false,
	}
}
