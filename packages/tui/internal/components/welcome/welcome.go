package welcome

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/theme"
)

// WelcomeScreen returns the EvalOps welcome screen
func WelcomeScreen(width, height int) string {
	t := theme.CurrentTheme()

	// Create gradient effect with EvalOps colors

	subtitleStyle := lipgloss.NewStyle().
		Foreground(t.Secondary()).
		Italic(true)

	taglineStyle := lipgloss.NewStyle().
		Foreground(t.TextMuted())

	infoStyle := lipgloss.NewStyle().
		Foreground(t.Text())

	accentStyle := lipgloss.NewStyle().
		Foreground(t.Accent())

	// ASCII Art logo
	logo := []string{
		"███████╗██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ███████╗",
		"██╔════╝██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝",
		"█████╗  ██║   ██║███████║██║     ██║   ██║██████╔╝███████╗",
		"██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║",
		"███████╗ ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║     ███████║",
		"╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝",
	}

	// Render logo with gradient
	var renderedLogo []string
	for i, line := range logo {
		// Create gradient from primary to secondary
		progress := float64(i) / float64(len(logo)-1)
		var color compat.AdaptiveColor
		if progress < 0.5 {
			color = t.Primary()
		} else {
			color = t.Secondary()
		}
		style := lipgloss.NewStyle().Foreground(color)
		renderedLogo = append(renderedLogo, style.Render(line))
	}

	// Build the welcome message
	var content strings.Builder

	// Add logo
	for _, line := range renderedLogo {
		content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, line))
		content.WriteString("\n")
	}

	content.WriteString("\n")

	// Add tagline
	tagline := taglineStyle.Render("Trust, but Verify™")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, tagline))
	content.WriteString("\n\n")

	// Add version and description
	version := subtitleStyle.Render("v1.0.0")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, version))
	content.WriteString("\n\n")

	// Add welcome text
	welcomeText := []string{
		infoStyle.Render("Welcome to EvalOps - Continuous Evaluation for AI-Generated Code"),
		"",
		accentStyle.Render("🎯 Every line of code is automatically evaluated"),
		accentStyle.Render("📊 Real-time quality metrics and scoring"),
		accentStyle.Render("🔍 Comprehensive test coverage analysis"),
		accentStyle.Render("⚡ Performance and security assessments"),
		"",
		taglineStyle.Render("Press ? for help • Start typing to begin • Ctrl+E for evaluation dashboard"),
	}

	for _, line := range welcomeText {
		content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, line))
		content.WriteString("\n")
	}

	// Add status indicators
	content.WriteString("\n\n")

	statusLine := fmt.Sprintf(
		"%s EvalOps Ready %s Evaluation: %s %s Tests: %s",
		accentStyle.Render("●"),
		taglineStyle.Render("•"),
		lipgloss.NewStyle().Foreground(t.Success()).Render("Active"),
		taglineStyle.Render("•"),
		lipgloss.NewStyle().Foreground(t.Info()).Render("0 pending"),
	)
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, statusLine))

	// Center vertically
	result := lipgloss.PlaceVertical(height, lipgloss.Center, content.String())

	return result
}

// EmptySessionMessage returns the message shown when no session is active
func EmptySessionMessage(width, height int) string {
	t := theme.CurrentTheme()

	iconStyle := lipgloss.NewStyle().
		Foreground(t.Accent()).
		Bold(true)

	textStyle := lipgloss.NewStyle().
		Foreground(t.TextMuted())

	var content strings.Builder

	icon := iconStyle.Render("🎯")
	message := textStyle.Render("No active session")
	hint := textStyle.Render("Start typing to create a new evaluation session")

	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, icon))
	content.WriteString("\n\n")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, message))
	content.WriteString("\n")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, hint))

	return lipgloss.PlaceVertical(height/2, lipgloss.Center, content.String())
}