package status

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/fsnotify/fsnotify"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

type GitBranchUpdatedMsg struct {
	Branch string
}

type StatusComponent interface {
	tea.Model
	tea.ViewModel
	Cleanup()
}

type statusComponent struct {
	app        *app.App
	width      int
	cwd        string
	branch     string
	watcher    *fsnotify.Watcher
	done       chan struct{}
	lastUpdate time.Time
}

func (m *statusComponent) Init() tea.Cmd {
	return m.startGitWatcher()
}

func (m *statusComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case GitBranchUpdatedMsg:
		if m.branch != msg.Branch {
			m.branch = msg.Branch
		}
		// Continue watching for changes (persistent watcher)
		return m, m.watchForGitChanges()
	}
	return m, nil
}

func (m *statusComponent) logo() string {
	t := theme.CurrentTheme()
	base := styles.NewStyle().Foreground(t.TextMuted()).Background(t.BackgroundElement()).Render
	emphasis := styles.NewStyle().
		Foreground(t.Text()).
		Background(t.BackgroundElement()).
		Bold(true).
		Render

	open := base("open")
	code := emphasis("code")
	version := base(" " + m.app.Version)

	content := open + code
	if m.width > 40 {
		content += version
	}
	return styles.NewStyle().
		Background(t.BackgroundElement()).
		Padding(0, 1).
		Render(content)
}

func (m *statusComponent) collapsePath(path string, maxWidth int) string {
	if lipgloss.Width(path) <= maxWidth {
		return path
	}

	const ellipsis = ".."
	ellipsisLen := len(ellipsis)

	if maxWidth <= ellipsisLen {
		if maxWidth > 0 {
			return "..."[:maxWidth]
		}
		return ""
	}

	separator := string(filepath.Separator)
	parts := strings.Split(path, separator)

	if len(parts) == 1 {
		return path[:maxWidth-ellipsisLen] + ellipsis
	}

	truncatedPath := parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0; i-- {
		part := parts[i]
		if len(truncatedPath)+len(separator)+len(part)+ellipsisLen > maxWidth {
			return ellipsis + separator + truncatedPath
		}
		truncatedPath = part + separator + truncatedPath
	}
	return truncatedPath
}

func (m *statusComponent) View() string {
	t := theme.CurrentTheme()
	logo := m.logo()
	logoWidth := lipgloss.Width(logo)

	var modeBackground compat.AdaptiveColor
	var modeForeground compat.AdaptiveColor

	agentColor := util.GetAgentColor(m.app.AgentIndex)

	if m.app.AgentIndex == 0 {
		modeBackground = t.BackgroundElement()
		modeForeground = agentColor
	} else {
		modeBackground = agentColor
		modeForeground = t.BackgroundPanel()
	}

	command := m.app.Commands[commands.AgentCycleCommand]
	kb := command.Keybindings[0]
	key := kb.Key
	if kb.RequiresLeader {
		key = m.app.Config.Keybinds.Leader + " " + kb.Key
	}

	agentStyle := styles.NewStyle().Background(modeBackground).Foreground(modeForeground)
	agentNameStyle := agentStyle.Bold(true).Render
	agentDescStyle := agentStyle.Render
	agent := agentNameStyle(strings.ToUpper(m.app.Agent().Name)) + agentDescStyle(" AGENT")
	agent = agentStyle.
		Padding(0, 1).
		BorderLeft(true).
		BorderStyle(lipgloss.ThickBorder()).
		BorderForeground(modeBackground).
		BorderBackground(t.BackgroundPanel()).
		Render(agent)

	faintStyle := styles.NewStyle().
		Faint(true).
		Background(t.BackgroundPanel()).
		Foreground(t.TextMuted())
	agent = faintStyle.Render(key+" ") + agent
	modeWidth := lipgloss.Width(agent)

	availableWidth := m.width - logoWidth - modeWidth
	branchSuffix := ""
	if m.branch != "" {
		branchSuffix = ":" + m.branch
	}

	maxCwdWidth := availableWidth - lipgloss.Width(branchSuffix)
	cwdDisplay := m.collapsePath(m.cwd, maxCwdWidth)

	if m.branch != "" && availableWidth > lipgloss.Width(cwdDisplay)+lipgloss.Width(branchSuffix) {
		cwdDisplay += faintStyle.Render(branchSuffix)
	}

	cwd := styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel()).
		Padding(0, 1).
		Render(cwdDisplay)

	background := t.BackgroundPanel()
	status := layout.Render(
		layout.FlexOptions{
			Background: &background,
			Direction:  layout.Row,
			Justify:    layout.JustifySpaceBetween,
			Align:      layout.AlignStretch,
			Width:      m.width,
		},
		layout.FlexItem{
			View: logo + cwd,
		},
		layout.FlexItem{
			View: agent,
		},
	)

	blank := styles.NewStyle().Background(t.Background()).Width(m.width).Render("")
	return blank + "\n" + status
}

func (m *statusComponent) startGitWatcher() tea.Cmd {
	cmd := util.CmdHandler(
		GitBranchUpdatedMsg{Branch: getCurrentGitBranch(util.CwdPath)},
	)
	if err := m.initWatcher(); err != nil {
		return cmd
	}
	return tea.Batch(cmd, m.watchForGitChanges())
}

func (m *statusComponent) initWatcher() error {
	gitDir := filepath.Join(util.CwdPath, ".git")
	headFile := filepath.Join(gitDir, "HEAD")
	if info, err := os.Stat(gitDir); err != nil || !info.IsDir() {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	if err := watcher.Add(headFile); err != nil {
		watcher.Close()
		return err
	}

	// Also watch the ref file if HEAD points to a ref
	refFile := getGitRefFile(util.CwdPath)
	if refFile != headFile && refFile != "" {
		if _, err := os.Stat(refFile); err == nil {
			watcher.Add(refFile) // Ignore error, HEAD watching is sufficient
		}
	}

	m.watcher = watcher
	m.done = make(chan struct{})
	return nil
}

func (m *statusComponent) watchForGitChanges() tea.Cmd {
	if m.watcher == nil {
		return nil
	}

	return tea.Cmd(func() tea.Msg {
		for {
			select {
			case event, ok := <-m.watcher.Events:
				branch := getCurrentGitBranch(util.CwdPath)
				if !ok {
					return GitBranchUpdatedMsg{Branch: branch}
				}
				if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
					// Debounce updates to prevent excessive refreshes
					now := time.Now()
					if now.Sub(m.lastUpdate) < 100*time.Millisecond {
						continue
					}
					m.lastUpdate = now
					if strings.HasSuffix(event.Name, "HEAD") {
						m.updateWatchedFiles()
					}
					return GitBranchUpdatedMsg{Branch: branch}
				}
			case <-m.watcher.Errors:
				// Continue watching even on errors
			case <-m.done:
				return GitBranchUpdatedMsg{Branch: ""}
			}
		}
	})
}

func (m *statusComponent) updateWatchedFiles() {
	if m.watcher == nil {
		return
	}
	refFile := getGitRefFile(util.CwdPath)
	headFile := filepath.Join(util.CwdPath, ".git", "HEAD")
	if refFile != headFile && refFile != "" {
		if _, err := os.Stat(refFile); err == nil {
			// Try to add the new ref file (ignore error if already watching)
			m.watcher.Add(refFile)
		}
	}
}

func getCurrentGitBranch(cwd string) string {
	cmd := exec.Command("git", "branch", "--show-current")
	cmd.Dir = cwd
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func getGitRefFile(cwd string) string {
	headFile := filepath.Join(cwd, ".git", "HEAD")
	content, err := os.ReadFile(headFile)
	if err != nil {
		return ""
	}

	headContent := strings.TrimSpace(string(content))
	if after, ok := strings.CutPrefix(headContent, "ref: "); ok {
		// HEAD points to a ref file
		refPath := after
		return filepath.Join(cwd, ".git", refPath)
	}

	// HEAD contains a direct commit hash
	return headFile
}

func (m *statusComponent) Cleanup() {
	if m.done != nil {
		close(m.done)
	}
	if m.watcher != nil {
		m.watcher.Close()
	}
}

func NewStatusCmp(app *app.App) StatusComponent {
	statusComponent := &statusComponent{
		app:        app,
		lastUpdate: time.Now(),
	}

	homePath, err := os.UserHomeDir()
	cwdPath := util.CwdPath
	if err == nil && homePath != "" && strings.HasPrefix(cwdPath, homePath) {
		cwdPath = "~" + cwdPath[len(homePath):]
	}
	statusComponent.cwd = cwdPath

	return statusComponent
}
