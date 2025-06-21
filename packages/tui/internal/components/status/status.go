package status

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type StatusComponent interface {
	tea.Model
	tea.ViewModel
}

type statusComponent struct {
	app   *app.App
	width int
}

func (m statusComponent) Init() tea.Cmd {
	return nil
}

func (m statusComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	}
	return m, nil
}

func (m statusComponent) logo() string {
	t := theme.CurrentTheme()
	base := lipgloss.NewStyle().Background(t.BackgroundElement()).Foreground(t.TextMuted()).Render
	emphasis := lipgloss.NewStyle().Bold(true).Background(t.BackgroundElement()).Foreground(t.Text()).Render

	open := base("open")
	code := emphasis("code ")
	version := base(m.app.Version)
	return styles.Padded().
		Background(t.BackgroundElement()).
		Render(open + code + version)
}

func formatTokensAndCost(tokens float32, contextWindow float32, cost float32) string {
	// Format tokens in human-readable format (e.g., 110K, 1.2M)
	var formattedTokens string
	switch {
	case tokens >= 1_000_000:
		formattedTokens = fmt.Sprintf("%.1fM", float64(tokens)/1_000_000)
	case tokens >= 1_000:
		formattedTokens = fmt.Sprintf("%.1fK", float64(tokens)/1_000)
	default:
		formattedTokens = fmt.Sprintf("%d", int(tokens))
	}

	// Remove .0 suffix if present
	if strings.HasSuffix(formattedTokens, ".0K") {
		formattedTokens = strings.Replace(formattedTokens, ".0K", "K", 1)
	}
	if strings.HasSuffix(formattedTokens, ".0M") {
		formattedTokens = strings.Replace(formattedTokens, ".0M", "M", 1)
	}

	// Format cost with $ symbol and 2 decimal places
	formattedCost := fmt.Sprintf("$%.2f", cost)
	percentage := (float64(tokens) / float64(contextWindow)) * 100

	return fmt.Sprintf("Tokens: %s (%d%%), Cost: %s", formattedTokens, int(percentage), formattedCost)
}

func (m statusComponent) View() string {
	t := theme.CurrentTheme()
	if m.app.Session.Id == "" {
		return styles.BaseStyle().
			Background(t.Background()).
			Width(m.width).
			Height(2).
			Render("")
	}

	logo := m.logo()

	cwd := styles.Padded().
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel()).
		Render(m.app.Info.Path.Cwd)

	sessionInfo := ""
	if m.app.Session.Id != "" {
		tokens := float32(0)
		cost := float32(0)
		contextWindow := m.app.MainModel.Limit.Context

		for _, message := range m.app.Messages {
			if message.Metadata.Assistant != nil {
				cost += message.Metadata.Assistant.Cost
				usage := message.Metadata.Assistant.Tokens
				if usage.Output > 0 {
					tokens = (usage.Input +
						usage.Cache.Write +
						usage.Cache.Read +
						usage.Output +
						usage.Reasoning)
				}
			}
		}

		sessionInfo = styles.Padded().
			Background(t.BackgroundElement()).
			Foreground(t.TextMuted()).
			Render(formatTokensAndCost(tokens, contextWindow, cost))
	}

	// diagnostics := styles.Padded().Background(t.BackgroundElement()).Render(m.projectDiagnostics())

	space := max(
		0,
		m.width-lipgloss.Width(logo)-lipgloss.Width(cwd)-lipgloss.Width(sessionInfo),
	)
	spacer := lipgloss.NewStyle().Background(t.BackgroundPanel()).Width(space).Render("")

	status := logo + cwd + spacer + sessionInfo

	blank := styles.BaseStyle().Background(t.Background()).Width(m.width).Render("")
	return blank + "\n" + status
}

func NewStatusCmp(app *app.App) StatusComponent {
	statusComponent := &statusComponent{
		app: app,
	}

	return statusComponent
}
