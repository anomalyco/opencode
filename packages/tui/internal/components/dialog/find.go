package dialog

import (
	"log/slog"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/textinput"
	tea "github.com/charmbracelet/bubbletea/v2"
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

type findDialogComponent struct {
	query              string
	completionProvider CompletionProvider
	width, height      int
	modal              *modal.Modal
	textInput          textinput.Model
	list               list.List[CompletionItemI]
}

type findDialogKeyMap struct {
	Select key.Binding
	Cancel key.Binding
}

var findDialogKeys = findDialogKeyMap{
	Select: key.NewBinding(
		key.WithKeys("enter"),
	),
	Cancel: key.NewBinding(
		key.WithKeys("esc"),
	),
}

func (f *findDialogComponent) Init() tea.Cmd {
	return textinput.Blink
}

func (f *findDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case []CompletionItemI:
		f.list.SetItems(msg)
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			if f.textInput.Value() == "" {
				return f, nil
			}
			f.textInput.SetValue("")
			return f.update(msg)
		}

		switch {
		case key.Matches(msg, findDialogKeys.Select):
			item, i := f.list.GetSelectedItem()
			if i == -1 {
				return f, nil
			}
			return f, f.selectFile(item)
		case key.Matches(msg, findDialogKeys.Cancel):
			return f, f.Close()
		default:
			f.textInput, cmd = f.textInput.Update(msg)
			cmds = append(cmds, cmd)

			f, cmd = f.update(msg)
			cmds = append(cmds, cmd)
		}
	}

	return f, tea.Batch(cmds...)
}

func (f *findDialogComponent) update(msg tea.Msg) (*findDialogComponent, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	query := f.textInput.Value()
	if query != f.query {
		f.query = query
		cmd = func() tea.Msg {
			items, err := f.completionProvider.GetChildEntries(query)
			if err != nil {
				slog.Error("Failed to get completion items", "error", err)
			}
			return items
		}
		cmds = append(cmds, cmd)
	}

	u, cmd := f.list.Update(msg)
	f.list = u.(list.List[CompletionItemI])
	cmds = append(cmds, cmd)

	return f, tea.Batch(cmds...)
}

func (f *findDialogComponent) View() string {
	t := theme.CurrentTheme()
	f.textInput.SetWidth(f.width - 8)
	f.list.SetMaxWidth(f.width - 4)
	inputView := f.textInput.View()
	inputView = styles.NewStyle().
		Background(t.BackgroundElement()).
		Height(1).
		Width(f.width-4).
		Padding(0, 0).
		Render(inputView)

	listView := f.list.View()
	return styles.NewStyle().Height(12).Render(inputView + "\n" + listView)
}

func (f *findDialogComponent) SetWidth(width int) {
	f.width = width
	if width > 4 {
		f.textInput.SetWidth(width - 4)
		f.list.SetMaxWidth(width - 4)
	}
}

func (f *findDialogComponent) SetHeight(height int) {
	f.height = height
}

func (f *findDialogComponent) IsEmpty() bool {
	return f.list.IsEmpty()
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
	f.textInput.Reset()
	f.textInput.Blur()
	return util.CmdHandler(modal.CloseModalMsg{})
}

func createTextInput(existing *textinput.Model) textinput.Model {
	t := theme.CurrentTheme()
	bgColor := t.BackgroundElement()
	textColor := t.Text()
	textMutedColor := t.TextMuted()

	ti := textinput.New()

	ti.Styles.Blurred.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Blurred.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ti.Styles.Focused.Placeholder = styles.NewStyle().
		Foreground(textMutedColor).
		Background(bgColor).
		Lipgloss()
	ti.Styles.Focused.Text = styles.NewStyle().Foreground(textColor).Background(bgColor).Lipgloss()
	ti.Styles.Cursor.Color = t.Primary()
	ti.VirtualCursor = true

	ti.Prompt = " "
	ti.CharLimit = -1
	ti.Focus()

	if existing != nil {
		ti.SetValue(existing.Value())
		ti.SetWidth(existing.Width())
	}

	return ti
}

func NewFindDialog(completionProvider CompletionProvider) FindDialog {
	ti := createTextInput(nil)

	li := list.NewListComponent(
		[]CompletionItemI{},
		10, // max visible items
		completionProvider.GetEmptyMessage(),
		false,
	)

	go func() {
		items, err := completionProvider.GetChildEntries("")
		if err != nil {
			slog.Error("Failed to get completion items", "error", err)
		}
		li.SetItems(items)
	}()

	return &findDialogComponent{
		query:              "",
		completionProvider: completionProvider,
		textInput:          ti,
		list:               li,
		modal: modal.New(
			modal.WithTitle("Find Files"),
			modal.WithMaxWidth(80),
		),
	}
}
