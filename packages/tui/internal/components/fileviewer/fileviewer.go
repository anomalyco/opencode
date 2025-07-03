package fileviewer

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"

	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/components/diff"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type DiffStyle int

const (
	DiffStyleSplit DiffStyle = iota
	DiffStyleUnified
)

type Model struct {
	app           *app.App
	width, height int
	viewport      viewport.Model
	filename      *string
	content       *string
	isDiff        *bool
	diffStyle     DiffStyle
}

type fileRenderedMsg struct {
	content string
}

func New(app *app.App) Model {
	vp := viewport.New()
	m := Model{
		app:       app,
		viewport:  vp,
		diffStyle: DiffStyleUnified,
	}
	if app.State.SplitDiff {
		m.diffStyle = DiffStyleSplit
	}
	return m
}

func (m Model) Init() tea.Cmd {
	return m.viewport.Init()
}

func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case fileRenderedMsg:
		m.viewport.SetContent(msg.content)
		return m, util.CmdHandler(app.FileRenderedMsg{
			FilePath: *m.filename,
		})
	case dialog.ThemeSelectedMsg:
		return m, m.render()
	case tea.KeyMsg:
		switch msg.String() {
		// TODO
		}
	}

	vp, cmd := m.viewport.Update(msg)
	m.viewport = vp
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m Model) View() string {
	if !m.HasFile() {
		return ""
	}

	header := *m.filename
	header = styles.NewStyle().
		Padding(1, 2).
		Width(m.width).
		Background(theme.CurrentTheme().BackgroundElement()).
		Foreground(theme.CurrentTheme().Text()).
		Render(header)

	t := theme.CurrentTheme()

	close := m.app.Key(commands.FileCloseCommand)
	diffToggle := m.app.Key(commands.FileDiffToggleCommand)
	if m.isDiff == nil || *m.isDiff == false {
		diffToggle = ""
	}
	layoutToggle := m.app.Key(commands.MessagesLayoutToggleCommand)

	background := t.Background()
	footer := layout.Render(
		layout.FlexOptions{
			Background: &background,
			Direction:  layout.Row,
			Justify:    layout.JustifyCenter,
			Align:      layout.AlignStretch,
			Width:      m.width - 2,
			Gap:        5,
		},
		layout.FlexItem{
			View: close,
		},
		layout.FlexItem{
			View: layoutToggle,
		},
		layout.FlexItem{
			View: diffToggle,
		},
	)
	footer = styles.NewStyle().Background(t.Background()).Padding(0, 1).Render(footer)

	return header + "\n" + m.viewport.View() + "\n" + footer
}

func (m *Model) Clear() (Model, tea.Cmd) {
	m.filename = nil
	m.content = nil
	m.isDiff = nil
	return *m, m.render()
}

func (m *Model) ToggleDiff() (Model, tea.Cmd) {
	switch m.diffStyle {
	case DiffStyleSplit:
		m.diffStyle = DiffStyleUnified
	default:
		m.diffStyle = DiffStyleSplit
	}
	return *m, m.render()
}

func (m *Model) DiffStyle() DiffStyle {
	return m.diffStyle
}

func (m Model) HasFile() bool {
	return m.filename != nil && m.content != nil
}

func (m Model) Filename() string {
	if m.filename == nil {
		return ""
	}
	return *m.filename
}

func (m *Model) SetSize(width, height int) (Model, tea.Cmd) {
	if m.width != width || m.height != height {
		m.width = width
		m.height = height
		m.viewport.SetWidth(width)
		m.viewport.SetHeight(height - 4)
		return *m, m.render()
	}
	return *m, nil
}

func (m *Model) SetFile(filename string, content string, isDiff bool) (Model, tea.Cmd) {
	m.filename = &filename
	m.content = &content
	m.isDiff = &isDiff
	return *m, m.render()
}

func (m *Model) render() tea.Cmd {
	if m.filename == nil || m.content == nil {
		m.viewport.SetContent("")
		return nil
	}

	return func() tea.Msg {
		t := theme.CurrentTheme()
		var rendered string

		if m.isDiff != nil && *m.isDiff {
			diffResult := ""
			var err error
			if m.diffStyle == DiffStyleSplit {
				diffResult, err = diff.FormatDiff(
					*m.filename,
					*m.content,
					diff.WithWidth(m.width),
				)
			} else if m.diffStyle == DiffStyleUnified {
				diffResult, err = diff.FormatUnifiedDiff(
					*m.filename,
					*m.content,
					diff.WithWidth(m.width),
				)
			}
			if err != nil {
				rendered = styles.NewStyle().
					Foreground(t.Error()).
					Render(fmt.Sprintf("Error rendering diff: %v", err))
			} else {
				rendered = strings.TrimRight(diffResult, "\n")
			}
		} else {
			rendered = util.RenderFile(
				*m.filename,
				*m.content,
				m.width,
			)
		}

		rendered = styles.NewStyle().
			Width(m.width).
			Background(t.BackgroundPanel()).
			Render(rendered)

		return fileRenderedMsg{
			content: rendered,
		}
	}
}

func (m *Model) ScrollTo(line int) {
	m.viewport.SetYOffset(line)
}

func (m *Model) ScrollToBottom() {
	m.viewport.GotoBottom()
}

func (m *Model) ScrollToTop() {
	m.viewport.GotoTop()
}

func (m *Model) PageUp() (Model, tea.Cmd) {
	m.viewport.ViewUp()
	return *m, nil
}

func (m *Model) PageDown() (Model, tea.Cmd) {
	m.viewport.ViewDown()
	return *m, nil
}

func (m *Model) HalfPageUp() (Model, tea.Cmd) {
	m.viewport.HalfViewUp()
	return *m, nil
}

func (m *Model) HalfPageDown() (Model, tea.Cmd) {
	m.viewport.HalfViewDown()
	return *m, nil
}

func (m Model) AtTop() bool {
	return m.viewport.AtTop()
}

func (m Model) AtBottom() bool {
	return m.viewport.AtBottom()
}

func (m Model) ScrollPercent() float64 {
	return m.viewport.ScrollPercent()
}

func (m Model) TotalLineCount() int {
	return m.viewport.TotalLineCount()
}

func (m Model) VisibleLineCount() int {
	return m.viewport.VisibleLineCount()
}
