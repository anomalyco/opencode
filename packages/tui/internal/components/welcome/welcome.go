package welcome

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

// WelcomeScreen returns the EvalOps welcome screen
func WelcomeScreen(width, height int) string {
	t := theme.CurrentTheme()

	// Build the welcome message
	var content strings.Builder

	// Responsive logo - show ASCII art only on wide screens
	if width >= 100 {
		// Full ASCII Art logo for wide screens
		logo := []string{
			"███████╗██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ███████╗",
			"██╔════╝██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝",
			"█████╗  ██║   ██║███████║██║     ██║   ██║██████╔╝███████╗",
			"██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║",
			"███████╗ ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║     ███████║",
			"╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝",
		}

		// Render logo with consistent primary color (no gradient for cleaner look)
		for _, line := range logo {
			styledLine := styles.H1.Render(line)
			content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, styledLine))
			content.WriteString("\n")
		}
	} else {
		// Compact banner for narrow screens
		banner := styles.H1.Render("🎯 EvalOps")
		content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, banner))
		content.WriteString("\n")
	}

	// Add tagline with subtle rule
	ruleWidth := min(width/3, 40)
	rule := styles.Separator().Render(strings.Repeat("─", ruleWidth))
	tagline := styles.Muted.Italic(true).Render("Trust, but Verify™")
	
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, rule))
	content.WriteString("\n")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, tagline))
	content.WriteString("\n")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, rule))
	content.WriteString("\n\n")

	// Add version
	version := styles.H2.Render("v1.0.0")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, version))
	content.WriteString("\n\n")

	// Add welcome text with consistent spacing
	welcomeText := []string{
		styles.Body.Render("Welcome to EvalOps - Continuous Evaluation for AI-Generated Code"),
		"",
		styles.Strong.Render("🎯 Every line of code is automatically evaluated"),
		styles.Strong.Render("📊 Real-time quality metrics and scoring"),
		styles.Strong.Render("🔍 Comprehensive test coverage analysis"),
		styles.Strong.Render("⚡ Performance and security assessments"),
		"",
		styles.Muted.Render("Press ? for help • Start typing to begin • Ctrl+E for evaluation dashboard"),
	}

	for _, line := range welcomeText {
		content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, line))
		content.WriteString("\n")
	}

	// Add consistent spacing
	content.WriteString("\n")

	// Status indicators with typography system
	statusLine := fmt.Sprintf(
		"%s EvalOps Ready %s Evaluation: %s %s Tests: %s",
		styles.Strong.Render("●"),
		styles.Muted.Render("•"),
		lipgloss.NewStyle().Foreground(t.Success()).Render("Active"),
		styles.Muted.Render("•"),
		lipgloss.NewStyle().Foreground(t.Info()).Render("0 pending"),
	)
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, statusLine))

	// Center vertically
	result := lipgloss.PlaceVertical(height, lipgloss.Center, content.String())

	return result
}

// EmptySessionMessage returns the message shown when no session is active
func EmptySessionMessage(width, height int) string {
	var content strings.Builder

	icon := styles.Strong.Render("🎯")
	message := styles.H2.Render("No active session")
	hint := styles.Muted.Render("Start typing to create a new evaluation session")

	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, icon))
	content.WriteString("\n")
	content.WriteString(strings.Repeat("\n", styles.SpY))
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, message))
	content.WriteString("\n")
	content.WriteString(lipgloss.PlaceHorizontal(width, lipgloss.Center, hint))

	return lipgloss.PlaceVertical(height/2, lipgloss.Center, content.String())
}

// Helper function for min (Go 1.21+)
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}