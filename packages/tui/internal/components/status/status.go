package status

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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
	app    *app.App
	width  int
	cwd    string
	branch string
}

func (m statusComponent) Init() tea.Cmd {
	return m.watchGitHead()
}

func (m statusComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case GitBranchUpdatedMsg:
		if m.branch != msg.Branch {
			m.branch = msg.Branch
		}
		// Restart watching for next change
		return m, m.watchGitHead()
	}
	return m, nil
}

func (m statusComponent) logo() string {
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

func (m statusComponent) View() string {
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

func (m statusComponent) watchGitHead() tea.Cmd {
	return func() tea.Msg {
		gitDir := filepath.Join(m.app.Info.Path.Cwd, ".git")
		headFile := filepath.Join(gitDir, "HEAD")

		// Check if .git exists and is a directory
		if info, err := os.Stat(gitDir); err != nil || !info.IsDir() {
			return GitBranchUpdatedMsg{Branch: ""}
		}

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
		}

		// Watch .git/HEAD
		err = watcher.Add(headFile)
		if err != nil {
			watcher.Close()
			return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
		}

		// Also watch the ref file if HEAD points to a ref
		refFile := getGitRefFile(m.app.Info.Path.Cwd)
		if refFile != headFile && refFile != "" {
			// Only add if it's different from HEAD and exists
			if _, err := os.Stat(refFile); err == nil {
				watcher.Add(refFile) // Ignore error, HEAD watching is sufficient
			}
		}

		// Start watching and return initial branch
		go func() {
			// This will be handled by waitForGitChange
		}()

		return tea.Batch(
			func() tea.Msg { return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)} },
			m.waitForGitChange(watcher),
		)
	}
}
func (m statusComponent) waitForGitChange(watcher *fsnotify.Watcher) tea.Cmd {
	return func() tea.Msg {
		defer watcher.Close()

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
				}
				if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
					return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					return GitBranchUpdatedMsg{Branch: getCurrentGitBranch(m.app.Info.Path.Cwd)}
				}
				// Continue watching even on errors
			}
		}
	}
}

func NewStatusCmp(app *app.App) StatusComponent {
	statusComponent := &statusComponent{
		app: app,
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
