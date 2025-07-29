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
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

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
	if strings.HasPrefix(headContent, "ref: ") {
		// HEAD points to a ref file
		refPath := strings.TrimPrefix(headContent, "ref: ")
		return filepath.Join(cwd, ".git", refPath)
	}

	// HEAD contains a direct commit hash
	return headFile
}

type GitBranchUpdatedMsg struct {
	Branch string
}

type StatusComponent interface {
	tea.Model
	tea.ViewModel
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
	code := emphasis("code ")
	version := base(m.app.Version)
	return styles.NewStyle().
		Background(t.BackgroundElement()).
		Padding(0, 1).
		Render(open + code + version)
}

func (m *statusComponent) View() string {
	t := theme.CurrentTheme()
	logo := m.logo()

	// Build cwd display with git branch if available
	cwdDisplay := m.cwd
	if m.branch != "" {
		cwdDisplay += " 🌿 " + m.branch
	}

	cwd := styles.NewStyle().
		Foreground(t.TextMuted()).
		Background(t.BackgroundPanel()).
		Padding(0, 1).
		Render(cwdDisplay)

	var modeBackground compat.AdaptiveColor
	var modeForeground compat.AdaptiveColor
	switch m.app.ModeIndex {
	case 0:
		modeBackground = t.BackgroundElement()
		modeForeground = t.TextMuted()
	case 1:
		modeBackground = t.Secondary()
		modeForeground = t.BackgroundPanel()
	case 2:
		modeBackground = t.Accent()
		modeForeground = t.BackgroundPanel()
	case 3:
		modeBackground = t.Success()
		modeForeground = t.BackgroundPanel()
	case 4:
		modeBackground = t.Warning()
		modeForeground = t.BackgroundPanel()
	case 5:
		modeBackground = t.Primary()
		modeForeground = t.BackgroundPanel()
	case 6:
		modeBackground = t.Error()
		modeForeground = t.BackgroundPanel()
	default:
		modeBackground = t.Secondary()
		modeForeground = t.BackgroundPanel()
	}

	command := m.app.Commands[commands.SwitchModeCommand]
	kb := command.Keybindings[0]
	key := kb.Key
	if kb.RequiresLeader {
		key = m.app.Config.Keybinds.Leader + " " + kb.Key
	}

	modeStyle := styles.NewStyle().Background(modeBackground).Foreground(modeForeground)
	modeNameStyle := modeStyle.Bold(true).Render
	modeDescStyle := modeStyle.Render
	mode := modeNameStyle(strings.ToUpper(m.app.Mode.Name)) + modeDescStyle(" MODE")
	mode = modeStyle.
		Padding(0, 1).
		BorderLeft(true).
		BorderStyle(lipgloss.ThickBorder()).
		BorderForeground(modeBackground).
		BorderBackground(t.BackgroundPanel()).
		Render(mode)

	mode = styles.NewStyle().
		Faint(true).
		Background(t.BackgroundPanel()).
		Foreground(t.TextMuted()).
		Render(key+" ") +
		mode

	space := max(
		0,
		m.width-lipgloss.Width(logo)-lipgloss.Width(cwd)-lipgloss.Width(mode),
	)
	spacer := styles.NewStyle().Background(t.BackgroundPanel()).Width(space).Render("")

	status := logo + cwd + spacer + mode

	blank := styles.NewStyle().Background(t.Background()).Width(m.width).Render("")
	return blank + "\n" + status
}

func (m *statusComponent) startGitWatcher() tea.Cmd {
	// Initialize the persistent watcher
	if err := m.initWatcher(); err != nil {
		// If watcher fails to initialize, just return current branch
		return func() tea.Msg { return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)} }
	}

	return tea.Batch(
		func() tea.Msg { return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)} },
		m.watchForGitChanges(),
	)
}

func (m *statusComponent) initWatcher() error {
	gitDir := filepath.Join(m.app.Info.Path.Cwd, ".git")
	headFile := filepath.Join(gitDir, "HEAD")

	// Check if .git exists and is a directory
	if info, err := os.Stat(gitDir); err != nil || !info.IsDir() {
		return err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	// Watch .git/HEAD
	if err := watcher.Add(headFile); err != nil {
		watcher.Close()
		return err
	}

	// Also watch the ref file if HEAD points to a ref
	refFile := getGitRefFile(m.app.Info.Path.Cwd)
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
				if !ok {
					return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
				}
				if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
					// Debounce updates to prevent excessive refreshes
					now := time.Now()
					if now.Sub(m.lastUpdate) < 100*time.Millisecond {
						continue
					}
					m.lastUpdate = now

					// Update ref file watching if HEAD changed
					if strings.HasSuffix(event.Name, "HEAD") {
						m.updateWatchedFiles()
					}
					return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
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

	// Add the new ref file if HEAD points to a different ref
	refFile := getGitRefFile(m.app.Info.Path.Cwd)
	headFile := filepath.Join(m.app.Info.Path.Cwd, ".git", "HEAD")

	if refFile != headFile && refFile != "" {
		if _, err := os.Stat(refFile); err == nil {
			// Try to add the new ref file (ignore error if already watching)
			m.watcher.Add(refFile)
		}
	}
}

func (m *statusComponent) cleanup() {
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
	cwdPath := app.Info.Path.Cwd
	if err == nil && homePath != "" && strings.HasPrefix(cwdPath, homePath) {
		cwdPath = "~" + cwdPath[len(homePath):]
	}
	statusComponent.cwd = cwdPath

	// Get git branch if we're in a git repository
	branch := getCurrentGitBranch(app.Info.Path.Cwd)
	statusComponent.branch = branch

	return statusComponent
}
