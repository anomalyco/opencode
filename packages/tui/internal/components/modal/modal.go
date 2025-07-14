package modal

import (
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

// CloseModalMsg is a message to signal that the active modal should be closed.
type CloseModalMsg struct{}

// Modal is a reusable modal component that handles frame rendering and overlay placement
type Modal struct {
	width      int
	height     int
	title      string
	maxWidth   int
	maxHeight  int
	fitContent bool
}

// ModalOption is a function that configures a Modal
type ModalOption func(*Modal)

// WithTitle sets the modal title
func WithTitle(title string) ModalOption {
	return func(m *Modal) {
		m.title = title
	}
}

// WithMaxWidth sets the maximum width
func WithMaxWidth(width int) ModalOption {
	return func(m *Modal) {
		m.maxWidth = width
		m.fitContent = false
	}
}

// WithMaxHeight sets the maximum height
func WithMaxHeight(height int) ModalOption {
	return func(m *Modal) {
		m.maxHeight = height
	}
}

func WithFitContent(fit bool) ModalOption {
	return func(m *Modal) {
		m.fitContent = fit
	}
}

// New creates a new Modal with the given options
func New(opts ...ModalOption) *Modal {
	m := &Modal{
		maxWidth:   0,
		maxHeight:  0,
		fitContent: true,
	}

	for _, opt := range opts {
		opt(m)
	}

	return m
}

func (m *Modal) SetTitle(title string) {
	m.title = title
}

// Render renders the modal centered on the screen
func (m *Modal) Render(contentView string, background string) string {
	t := theme.CurrentTheme()

	outerWidth := layout.Current.Container.Width - 8
	if m.maxWidth > 0 && outerWidth > m.maxWidth {
		outerWidth = m.maxWidth
	}

	if m.fitContent {
		titleWidth := lipgloss.Width(m.title)
		contentWidth := lipgloss.Width(contentView)
		largestWidth := max(titleWidth+2, contentWidth)
		outerWidth = largestWidth + 6
	}

	innerWidth := outerWidth - 4

	baseStyle := styles.NewStyle().Foreground(t.TextMuted()).Background(t.BackgroundPanel())

	var finalContent string
	if m.title != "" {
		titleStyle := baseStyle.
			Foreground(t.Text()).
			Bold(true).
			Padding(0, 1)

		escStyle := baseStyle.Foreground(t.TextMuted())
		escText := escStyle.Render("esc")

		// Calculate position for esc text
		titleWidth := lipgloss.Width(m.title)
		escWidth := lipgloss.Width(escText)
		spacesNeeded := max(0, innerWidth-titleWidth-escWidth-2)
		spacer := strings.Repeat(" ", spacesNeeded)
		titleLine := m.title + spacer + escText
		titleLine = titleStyle.Render(titleLine)

		finalContent = strings.Join([]string{titleLine, "", contentView}, "\n")
	} else {
		finalContent = contentView
	}

	modalStyle := baseStyle.
		PaddingTop(1).
		PaddingBottom(1).
		PaddingLeft(2).
		PaddingRight(2)

	modalView := modalStyle.
		Width(outerWidth).
		Render(finalContent)

	// Calculate position for centering
	bgHeight := lipgloss.Height(background)
	bgWidth := lipgloss.Width(background)
	modalHeight := lipgloss.Height(modalView)
	modalWidth := lipgloss.Width(modalView)

	row := (bgHeight - modalHeight) / 2
	col := (bgWidth - modalWidth) / 2

	return layout.PlaceOverlay(
		col-1, // TODO: whyyyyy
		row,
		modalView,
		background,
		layout.WithOverlayBorder(),
		layout.WithOverlayBorderColor(t.BorderActive()),
	)
}
