package dialog

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/viewport"
)

type evalsDialog struct {
	width    int
	height   int
	modal    *modal.Modal
	app      *app.App
	viewport viewport.Model
	
	// Evaluation state
	suites       []string
	selectedSuite int
	results      []EvalResult
	isRunning    bool
	lastRun      time.Time
}

type EvalResult struct {
	Suite     string
	Status    string // "running", "passed", "failed", "pending"
	Score     float64
	Tests     int
	Passed    int
	Failed    int
	Duration  time.Duration
	Timestamp time.Time
}

func (e *evalsDialog) Init() tea.Cmd {
	return e.viewport.Init()
}

func (e *evalsDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		e.width = msg.Width
		e.height = msg.Height
		// Set viewport size for the modal
		maxWidth := min(90, msg.Width-8)
		e.viewport = viewport.New(viewport.WithWidth(maxWidth-4), viewport.WithHeight(msg.Height-6))
	case tea.KeyMsg:
		switch msg.String() {
		case "j", "down":
			if e.selectedSuite < len(e.suites)-1 {
				e.selectedSuite++
			}
		case "k", "up":
			if e.selectedSuite > 0 {
				e.selectedSuite--
			}
		case "enter":
			if len(e.suites) > 0 {
				// TODO: Trigger evaluation run
				e.runEvaluation(e.suites[e.selectedSuite])
			}
		case "r":
			// Refresh/reload evaluations
			e.refreshResults()
		}
	}

	// Update viewport content
	e.viewport.SetContent(e.buildContent())

	// Update viewport
	var vpCmd tea.Cmd
	e.viewport, vpCmd = e.viewport.Update(msg)
	cmds = append(cmds, vpCmd)

	return e, tea.Batch(cmds...)
}

func (e *evalsDialog) View() string {
	return e.viewport.View()
}

func (e *evalsDialog) Render(background string) string {
	return e.modal.Render(e.View(), background)
}

func (e *evalsDialog) Close() tea.Cmd {
	return nil
}

func (e *evalsDialog) buildContent() string {
	var content strings.Builder

	// Header with EvalOps branding
	header := e.buildHeader()
	content.WriteString(header)
	content.WriteString("\n\n")

	// Quick stats overview
	stats := e.buildQuickStats()
	content.WriteString(stats)
	content.WriteString("\n\n")

	// Available suites
	if len(e.suites) > 0 {
		suitesSection := e.buildSuitesSection()
		content.WriteString(suitesSection)
		content.WriteString("\n\n")
	}

	// Recent results
	if len(e.results) > 0 {
		resultsSection := e.buildResultsSection()
		content.WriteString(resultsSection)
		content.WriteString("\n\n")
	}

	// Controls
	controls := e.buildControls()
	content.WriteString(controls)

	return content.String()
}

func (e *evalsDialog) buildHeader() string {
	t := theme.CurrentTheme()
	
	// Eye-catching but elegant header
	icon := styles.Strong.Render("🎯")
	title := styles.H1.Render("EvalOps Dashboard")
	subtitle := styles.Muted.Render("Continuous Evaluation & Trust Verification")
	
	// Create a subtle highlight box around the header
	headerContent := fmt.Sprintf("%s %s\n%s", icon, title, subtitle)
	
	return styles.NewStyle().
		Background(t.BackgroundElement()).
		Foreground(t.Text()).
		Padding(styles.SpY, styles.SpX).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(t.BorderSubtle()).
		Width(80).
		AlignHorizontal(lipgloss.Center).
		Render(headerContent)
}

func (e *evalsDialog) buildQuickStats() string {
	t := theme.CurrentTheme()
	
	totalRuns := len(e.results)
	passedRuns := 0
	avgScore := 0.0
	
	for _, result := range e.results {
		if result.Status == "passed" {
			passedRuns++
		}
		avgScore += result.Score
	}
	
	if totalRuns > 0 {
		avgScore /= float64(totalRuns)
	}
	
	// Create stat cards
	totalCard := e.buildStatCard("Total Runs", fmt.Sprintf("%d", totalRuns), t.Info())
	passedCard := e.buildStatCard("Passed", fmt.Sprintf("%d", passedRuns), t.Success())
	failedCard := e.buildStatCard("Failed", fmt.Sprintf("%d", totalRuns-passedRuns), t.Error())
	scoreCard := e.buildStatCard("Avg Score", fmt.Sprintf("%.1f%%", avgScore), t.Primary())
	
	// Arrange cards horizontally
	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		totalCard, "  ",
		passedCard, "  ", 
		failedCard, "  ",
		scoreCard,
	)
}

func (e *evalsDialog) buildStatCard(label, value string, color compat.AdaptiveColor) string {
	t := theme.CurrentTheme()
	
	labelStyle := styles.Muted.Render(label)
	valueStyle := styles.NewStyle().
		Foreground(color).
		Bold(true).
		Render(value)
	
	cardContent := fmt.Sprintf("%s\n%s", labelStyle, valueStyle)
	
	return styles.NewStyle().
		Background(t.BackgroundElement()).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(t.BorderSubtle()).
		Padding(styles.SpY, styles.SpX).
		Width(16).
		AlignHorizontal(lipgloss.Center).
		Render(cardContent)
}

func (e *evalsDialog) buildSuitesSection() string {
	t := theme.CurrentTheme()
	
	var content strings.Builder
	
	// Section header
	header := styles.H2.Render("📋 Available Test Suites")
	content.WriteString(header)
	content.WriteString("\n\n")
	
	// Suite list
	for i, suite := range e.suites {
		prefix := "  "
		style := styles.Body
		
		if i == e.selectedSuite {
			prefix = "❯ "
			style = styles.Strong.Background(t.BackgroundElement())
		}
		
		line := style.Render(prefix + suite)
		content.WriteString(line)
		content.WriteString("\n")
	}
	
	return content.String()
}

func (e *evalsDialog) buildResultsSection() string {
	var content strings.Builder
	
	// Section header
	header := styles.H2.Render("📊 Recent Results")
	content.WriteString(header)
	content.WriteString("\n\n")
	
	// Results table header
	headerRow := fmt.Sprintf("%-20s %-10s %-8s %-12s %-8s",
		"Suite", "Status", "Score", "Tests", "Duration")
	content.WriteString(styles.Strong.Render(headerRow))
	content.WriteString("\n")
	
	// Separator line
	separator := strings.Repeat("─", 65)
	content.WriteString(styles.Separator().Render(separator))
	content.WriteString("\n")
	
	// Results rows (show last 5)
	start := 0
	if len(e.results) > 5 {
		start = len(e.results) - 5
	}
	
	for _, result := range e.results[start:] {
		row := e.buildResultRow(result)
		content.WriteString(row)
		content.WriteString("\n")
	}
	
	return content.String()
}

func (e *evalsDialog) buildResultRow(result EvalResult) string {
	t := theme.CurrentTheme()
	
	// Status with color coding
	var statusIcon string
	var statusText string
	
	switch result.Status {
	case "passed":
		statusIcon = "✅ Passed"
		statusText = styles.NewStyle().Foreground(t.Success()).Render(statusIcon)
	case "failed":
		statusIcon = "❌ Failed"  
		statusText = styles.NewStyle().Foreground(t.Error()).Render(statusIcon)
	case "running":
		statusIcon = "🔄 Running"
		statusText = styles.NewStyle().Foreground(t.Warning()).Render(statusIcon)
	default:
		statusIcon = "⏳ Pending"
		statusText = styles.Muted.Render(statusIcon)
	}
	
	score := styles.NewStyle().Foreground(e.getScoreColor(result.Score)).Render(fmt.Sprintf("%.1f%%", result.Score))
	tests := styles.Body.Render(fmt.Sprintf("%d/%d", result.Passed, result.Tests))
	duration := styles.Muted.Render(result.Duration.Truncate(time.Millisecond).String())
	
	return fmt.Sprintf("%-20s %-18s %-8s %-12s %-8s",
		result.Suite, statusText, score, tests, duration)
}

func (e *evalsDialog) getScoreColor(score float64) compat.AdaptiveColor {
	t := theme.CurrentTheme()
	
	if score >= 90 {
		return t.Success()
	} else if score >= 70 {
		return t.Warning()
	}
	return t.Error()
}

func (e *evalsDialog) buildControls() string {
	var content strings.Builder
	
	// Control hints with eye-catching styling
	controls := []string{
		styles.Strong.Render("↑↓") + styles.Muted.Render(" navigate"),
		styles.Strong.Render("Enter") + styles.Muted.Render(" run suite"),
		styles.Strong.Render("r") + styles.Muted.Render(" refresh"),
		styles.Strong.Render("Esc") + styles.Muted.Render(" close"),
	}
	
	controlsText := strings.Join(controls, "  •  ")
	content.WriteString(styles.Muted.Render("Controls: "))
	content.WriteString(controlsText)
	
	return content.String()
}

func (e *evalsDialog) runEvaluation(suite string) {
	// TODO: Integrate with EvalOps tool execution
	e.isRunning = true
	e.lastRun = time.Now()
	
	// Simulate running evaluation (replace with actual EvalOps integration)
	result := EvalResult{
		Suite:     suite,
		Status:    "running",
		Score:     0,
		Tests:     0,
		Passed:    0,
		Failed:    0,
		Duration:  0,
		Timestamp: time.Now(),
	}
	
	e.results = append(e.results, result)
}

func (e *evalsDialog) refreshResults() {
	// TODO: Fetch latest evaluation results
	e.lastRun = time.Now()
}

// Helper function for min
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type EvalsDialog interface {
	layout.Modal
}

func NewEvalsDialog(app *app.App) EvalsDialog {
	// Sample data for demonstration
	suites := []string{
		"code-quality.js",
		"security-scan.js", 
		"performance-test.js",
		"integration-test.js",
	}
	
	sampleResults := []EvalResult{
		{
			Suite: "code-quality.js", Status: "passed", Score: 94.5,
			Tests: 15, Passed: 14, Failed: 1, Duration: 2300 * time.Millisecond,
			Timestamp: time.Now().Add(-10 * time.Minute),
		},
		{
			Suite: "security-scan.js", Status: "failed", Score: 67.8,
			Tests: 8, Passed: 5, Failed: 3, Duration: 1800 * time.Millisecond,
			Timestamp: time.Now().Add(-25 * time.Minute),
		},
		{
			Suite: "performance-test.js", Status: "passed", Score: 89.2,
			Tests: 12, Passed: 11, Failed: 1, Duration: 3100 * time.Millisecond,
			Timestamp: time.Now().Add(-1 * time.Hour),
		},
	}
	
	vp := viewport.New(viewport.WithHeight(20))
	
	return &evalsDialog{
		app:       app,
		modal:     modal.New(modal.WithTitle("🎯 EvalOps Dashboard"), modal.WithMaxWidth(90)),
		viewport:  vp,
		suites:    suites,
		results:   sampleResults,
		isRunning: false,
		lastRun:   time.Now().Add(-10 * time.Minute),
	}
}
