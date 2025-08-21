package dialog

import (
	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textinput"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/components/list"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

// SearchQueryChangedMsg is emitted when the search query changes
type SearchQueryChangedMsg struct {
	Query string
}

// SearchSelectionMsg is emitted when an item is selected
type SearchSelectionMsg struct {
	Item  any
	Index int
}

// SearchCancelledMsg is emitted when the search is cancelled
type SearchCancelledMsg struct{}

// SearchRemoveItemMsg is emitted when Ctrl+X is pressed to remove an item
type SearchRemoveItemMsg struct {
	Item  any
	Index int
}

// SearchDialog is a reusable component that combines a text input with a list
type SearchDialog struct {
	textInput textinput.Model
	list      list.List[list.Item]
	width     int
	height    int
	focused   bool
}

type searchKeyMap struct {
	Up     key.Binding
	Down   key.Binding
	Enter  key.Binding
	Escape key.Binding
	Remove key.Binding
}

var searchKeys = searchKeyMap{
	Up: key.NewBinding(
		key.WithKeys("up", "ctrl+p"),
		key.WithHelp("↑", "previous item"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "ctrl+n"),
		key.WithHelp("↓", "next item"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "select"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
	Remove: key.NewBinding(
		key.WithKeys("ctrl+x"),
		key.WithHelp("ctrl+x", "remove from recent"),
	),
}

// NewSearchDialog creates a new SearchDialog
func NewSearchDialog(placeholder string, maxVisibleHeight int) *SearchDialog {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundElement()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ti := textinput.New()
	ti.Placeholder = placeholder
	ti.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Blurred.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Text = styles.NewStyle().
		Foreground(textColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Prompt = styles.NewStyle().
		Background(bgColor).
		Lipgloss()
	ti.Styles.Cursor.Color = t.Primary()
	ti.VirtualCursor = true

	ti.Prompt = " "
	ti.CharLimit = -1
	ti.Focus()

	emptyList := list.NewListComponent(
		list.WithItems([]list.Item{}),
		list.WithMaxVisibleHeight[list.Item](maxVisibleHeight),
		list.WithFallbackMessage[list.Item](" No items"),
		list.WithAlphaNumericKeys[list.Item](false),
		list.WithRenderFunc(
			func(item list.Item, selected bool, width int, baseStyle styles.Style) string {
				return item.Render(selected, width, baseStyle)
			},
		),
		list.WithSelectableFunc(func(item list.Item) bool {
			return item.Selectable()
		}),
	)

	return &SearchDialog{
		textInput: ti,
		list:      emptyList,
		focused:   true,
	}
}

func (s *SearchDialog) Init() tea.Cmd {
	return textinput.Blink
}

func (s *SearchDialog) updateTextInput(msg tea.Msg) []tea.Cmd {
	var cmds []tea.Cmd
	oldValue := s.textInput.Value()
	var cmd tea.Cmd
	s.textInput, cmd = s.textInput.Update(msg)
	if cmd != nil {
		cmds = append(cmds, cmd)
	}
	if newValue := s.textInput.Value(); newValue != oldValue {
		cmds = append(cmds, func() tea.Msg {
			return SearchQueryChangedMsg{Query: newValue}
		})
	}
	return cmds
}

func (s *SearchDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.PasteMsg, tea.ClipboardMsg:
		cmds = append(cmds, s.updateTextInput(msg)...)
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			value := s.textInput.Value()
			if value == "" {
				return s, nil
			}
			s.textInput.Reset()
			cmds = append(cmds, func() tea.Msg {
				return SearchQueryChangedMsg{Query: ""}
			})
		}

		switch {
		case key.Matches(msg, searchKeys.Escape):
			return s, func() tea.Msg { return SearchCancelledMsg{} }

		case key.Matches(msg, searchKeys.Enter):
			if selectedItem, idx := s.list.GetSelectedItem(); idx != -1 {
				return s, func() tea.Msg {
					return SearchSelectionMsg{Item: selectedItem, Index: idx}
				}
			}

		case key.Matches(msg, searchKeys.Remove):
			if selectedItem, idx := s.list.GetSelectedItem(); idx != -1 {
				return s, func() tea.Msg {
					return SearchRemoveItemMsg{Item: selectedItem, Index: idx}
				}
			}

		case key.Matches(msg, searchKeys.Up):
			var cmd tea.Cmd
			listModel, cmd := s.list.Update(msg)
			s.list = listModel.(list.List[list.Item])
			if cmd != nil {
				cmds = append(cmds, cmd)
			}

		case key.Matches(msg, searchKeys.Down):
			var cmd tea.Cmd
			listModel, cmd := s.list.Update(msg)
			s.list = listModel.(list.List[list.Item])
			if cmd != nil {
				cmds = append(cmds, cmd)
			}

		default:
			cmds = append(cmds, s.updateTextInput(msg)...)
		}
	}

	return s, tea.Batch(cmds...)
}

func (s *SearchDialog) View() string {
	s.list.SetMaxWidth(s.width)
	listView := s.list.View()
	listView = lipgloss.PlaceVertical(s.list.GetMaxVisibleHeight(), lipgloss.Top, listView)
	textinput := s.textInput.View()
	return textinput + "\n\n" + listView
}

// SetWidth sets the width of the search dialog
func (s *SearchDialog) SetWidth(width int) {
	s.width = width
	s.textInput.SetWidth(width - 2) // Account for padding and borders
}

// SetHeight sets the height of the search dialog
func (s *SearchDialog) SetHeight(height int) {
	s.height = height
}

// SetItems updates the list items
func (s *SearchDialog) SetItems(items []list.Item) {
	s.list.SetItems(items)
}

// GetQuery returns the current search query
func (s *SearchDialog) GetQuery() string {
	return s.textInput.Value()
}

// SetQuery sets the search query
func (s *SearchDialog) SetQuery(query string) {
	s.textInput.SetValue(query)
}

// Focus focuses the search dialog
func (s *SearchDialog) Focus() {
	s.focused = true
	s.textInput.Focus()
}

// Blur removes focus from the search dialog
func (s *SearchDialog) Blur() {
	s.focused = false
	s.textInput.Blur()
}
