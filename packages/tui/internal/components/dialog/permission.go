package dialog

import (
	"fmt"
	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/viewport"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"strings"
)

type PermissionAction string

// Permission responses
const (
	PermissionAllow           PermissionAction = "allow"
	PermissionAllowForSession PermissionAction = "allow_session"
	PermissionDeny            PermissionAction = "deny"
)

// PermissionResponseMsg represents the user's response to a permission request
type PermissionResponseMsg struct {
	// Permission permission.PermissionRequest
	Action PermissionAction
}

// PermissionDialogComponent interface for permission dialog component
type PermissionDialogComponent interface {
	tea.Model
	tea.ViewModel
	// SetPermissions(permission permission.PermissionRequest) tea.Cmd
}

type permissionsMapping struct {
	Left         key.Binding
	Right        key.Binding
	EnterSpace   key.Binding
	Allow        key.Binding
	AllowSession key.Binding
	Deny         key.Binding
	Tab          key.Binding
}

var permissionsKeys = permissionsMapping{
	Left: key.NewBinding(
		key.WithKeys("left"),
		key.WithHelp("←", "switch options"),
	),
	Right: key.NewBinding(
		key.WithKeys("right"),
		key.WithHelp("→", "switch options"),
	),
	EnterSpace: key.NewBinding(
		key.WithKeys("enter", " "),
		key.WithHelp("enter/space", "confirm"),
	),
	Allow: key.NewBinding(
		key.WithKeys("a"),
		key.WithHelp("a", "allow"),
	),
	AllowSession: key.NewBinding(
		key.WithKeys("s"),
		key.WithHelp("s", "allow for session"),
	),
	Deny: key.NewBinding(
		key.WithKeys("d"),
		key.WithHelp("d", "deny"),
	),
	Tab: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "switch options"),
	),
}

// permissionDialogComponent is the implementation of PermissionDialog
type permissionDialogComponent struct {
	width  int
	height int
	// permission      permission.PermissionRequest
	windowSize      tea.WindowSizeMsg
	contentViewPort viewport.Model
	selectedOption  int // 0: Allow, 1: Allow for session, 2: Deny

	diffCache     map[string]string
	markdownCache map[string]string
}

func (p *permissionDialogComponent) Init() tea.Cmd {
	return p.contentViewPort.Init()
}

func (p *permissionDialogComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		p.windowSize = msg
		cmd := p.SetSize()
		cmds = append(cmds, cmd)
		p.markdownCache = make(map[string]string)
		p.diffCache = make(map[string]string)
		// case tea.KeyMsg:
		// 	switch {
		// 	case key.Matches(msg, permissionsKeys.Right) || key.Matches(msg, permissionsKeys.Tab):
		// 		p.selectedOption = (p.selectedOption + 1) % 3
		// 		return p, nil
		// 	case key.Matches(msg, permissionsKeys.Left):
		// 		p.selectedOption = (p.selectedOption + 2) % 3
		// 	case key.Matches(msg, permissionsKeys.EnterSpace):
		// 		return p, p.selectCurrentOption()
		// 	case key.Matches(msg, permissionsKeys.Allow):
		// 		return p, util.CmdHandler(PermissionResponseMsg{Action: PermissionAllow, Permission: p.permission})
		// 	case key.Matches(msg, permissionsKeys.AllowSession):
		// 		return p, util.CmdHandler(PermissionResponseMsg{Action: PermissionAllowForSession, Permission: p.permission})
		// 	case key.Matches(msg, permissionsKeys.Deny):
		// 		return p, util.CmdHandler(PermissionResponseMsg{Action: PermissionDeny, Permission: p.permission})
		// 	default:
		// 		// Pass other keys to viewport
		// 		viewPort, cmd := p.contentViewPort.Update(msg)
		// 		p.contentViewPort = viewPort
		// 		cmds = append(cmds, cmd)
		// 	}
	}

	return p, tea.Batch(cmds...)
}

func (p *permissionDialogComponent) selectCurrentOption() tea.Cmd {
	var action PermissionAction

	switch p.selectedOption {
	case 0:
		action = PermissionAllow
	case 1:
		action = PermissionAllowForSession
	case 2:
		action = PermissionDeny
	}

	return util.CmdHandler(PermissionResponseMsg{Action: action}) // , Permission: p.permission})
}

func (p *permissionDialogComponent) renderButtons() string {
	t := theme.CurrentTheme()
	baseStyle := styles.NewStyle().Foreground(t.Text())

	allowStyle := baseStyle
	allowSessionStyle := baseStyle
	denyStyle := baseStyle
	spacerStyle := baseStyle.Background(t.Background())

	// Style the selected button
	switch p.selectedOption {
	case 0:
		allowStyle = allowStyle.Background(t.Primary()).Foreground(t.Background())
		allowSessionStyle = allowSessionStyle.Background(t.Background()).Foreground(t.Primary())
		denyStyle = denyStyle.Background(t.Background()).Foreground(t.Primary())
	case 1:
		allowStyle = allowStyle.Background(t.Background()).Foreground(t.Primary())
		allowSessionStyle = allowSessionStyle.Background(t.Primary()).Foreground(t.Background())
		denyStyle = denyStyle.Background(t.Background()).Foreground(t.Primary())
	case 2:
		allowStyle = allowStyle.Background(t.Background()).Foreground(t.Primary())
		allowSessionStyle = allowSessionStyle.Background(t.Background()).Foreground(t.Primary())
		denyStyle = denyStyle.Background(t.Primary()).Foreground(t.Background())
	}

	allowButton := allowStyle.Padding(0, 1).Render("Allow (a)")
	allowSessionButton := allowSessionStyle.Padding(0, 1).Render("Allow for session (s)")
	denyButton := denyStyle.Padding(0, 1).Render("Deny (d)")

	content := lipgloss.JoinHorizontal(
		lipgloss.Left,
		allowButton,
		spacerStyle.Render("  "),
		allowSessionButton,
		spacerStyle.Render("  "),
		denyButton,
		spacerStyle.Render("  "),
	)

	remainingWidth := p.width - lipgloss.Width(content)
	if remainingWidth > 0 {
		content = spacerStyle.Render(strings.Repeat(" ", remainingWidth)) + content
	}
	return content
}

func (p *permissionDialogComponent) renderHeader() string {
	return "NOT IMPLEMENTED"
	// t := theme.CurrentTheme()
	// baseStyle := styles.BaseStyle()
	//
	// toolKey := baseStyle.Foreground(t.TextMuted()).Bold(true).Render("Tool")
	// toolValue := baseStyle.
	// 	Foreground(t.Text()).
	// 	Width(p.width - lipgloss.Width(toolKey)).
	// 	Render(fmt.Sprintf(": %s", p.permission.ToolName))
	//
	// pathKey := baseStyle.Foreground(t.TextMuted()).Bold(true).Render("Path")
	//
	// // Get the current working directory to display relative path
	// relativePath := p.permission.Path
	// if filepath.IsAbs(relativePath) {
	// 	if cwd, err := filepath.Rel(config.WorkingDirectory(), relativePath); err == nil {
	// 		relativePath = cwd
	// 	}
	// }
	//
	// pathValue := baseStyle.
	// 	Foreground(t.Text()).
	// 	Width(p.width - lipgloss.Width(pathKey)).
	// 	Render(fmt.Sprintf(": %s", relativePath))
	//
	// headerParts := []string{
	// 	lipgloss.JoinHorizontal(
	// 		lipgloss.Left,
	// 		toolKey,
	// 		toolValue,
	// 	),
	// 	baseStyle.Render(strings.Repeat(" ", p.width)),
	// 	lipgloss.JoinHorizontal(
	// 		lipgloss.Left,
	// 		pathKey,
	// 		pathValue,
	// 	),
	// 	baseStyle.Render(strings.Repeat(" ", p.width)),
	// }
	//
	// // Add tool-specific header information
	// switch p.permission.ToolName {
	// case "bash":
	// 	headerParts = append(headerParts, baseStyle.Foreground(t.TextMuted()).Width(p.width).Bold(true).Render("Command"))
	// case "edit":
	// 	headerParts = append(headerParts, baseStyle.Foreground(t.TextMuted()).Width(p.width).Bold(true).Render("Diff"))
	// case "write":
	// 	headerParts = append(headerParts, baseStyle.Foreground(t.TextMuted()).Width(p.width).Bold(true).Render("Diff"))
	// case "fetch":
	// 	headerParts = append(headerParts, baseStyle.Foreground(t.TextMuted()).Width(p.width).Bold(true).Render("URL"))
	// }
	//
	// return lipgloss.NewStyle().Background(t.Background()).Render(lipgloss.JoinVertical(lipgloss.Left, headerParts...))
}

func (p *permissionDialogComponent) renderBashContent() string {
	// t := theme.CurrentTheme()
	// baseStyle := styles.BaseStyle()
	//
	// if pr, ok := p.permission.Params.(tools.BashPermissionsParams); ok {
	// 	content := fmt.Sprintf("```bash\n%s\n```", pr.Command)
	//
	// 	// Use the cache for markdown rendering
	// 	renderedContent := p.GetOrSetMarkdown(p.permission.ID, func() (string, error) {
	// 		r := styles.GetMarkdownRenderer(p.width - 10)
	// 		s, err := r.Render(content)
	//    return s
	// 	})
	//
	// 	finalContent := baseStyle.
	// 		Width(p.contentViewPort.Width).
	// 		Render(renderedContent)
	// 	p.contentViewPort.SetContent(finalContent)
	// 	return p.styleViewport()
	// }
	return ""
}

func (p *permissionDialogComponent) renderEditContent() string {
	// if pr, ok := p.permission.Params.(tools.EditPermissionsParams); ok {
	// 	diff := p.GetOrSetDiff(p.permission.ID, func() (string, error) {
	// 		return diff.FormatDiff(pr.Diff, diff.WithTotalWidth(p.contentViewPort.Width))
	// 	})
	//
	// 	p.contentViewPort.SetContent(diff)
	// 	return p.styleViewport()
	// }
	return ""
}

func (p *permissionDialogComponent) renderPatchContent() string {
	// if pr, ok := p.permission.Params.(tools.EditPermissionsParams); ok {
	// 	diff := p.GetOrSetDiff(p.permission.ID, func() (string, error) {
	// 		return diff.FormatDiff(pr.Diff, diff.WithTotalWidth(p.contentViewPort.Width))
	// 	})
	//
	// 	p.contentViewPort.SetContent(diff)
	// 	return p.styleViewport()
	// }
	return ""
}

func (p *permissionDialogComponent) renderWriteContent() string {
	// if pr, ok := p.permission.Params.(tools.WritePermissionsParams); ok {
	// 	// Use the cache for diff rendering
	// 	diff := p.GetOrSetDiff(p.permission.ID, func() (string, error) {
	// 		return diff.FormatDiff(pr.Diff, diff.WithTotalWidth(p.contentViewPort.Width))
	// 	})
	//
	// 	p.contentViewPort.SetContent(diff)
	// 	return p.styleViewport()
	// }
	return ""
}

func (p *permissionDialogComponent) renderFetchContent() string {
	// 	t := theme.CurrentTheme()
	// 	baseStyle := styles.BaseStyle()
	//
	// 	if pr, ok := p.permission.Params.(tools.FetchPermissionsParams); ok {
	// 		content := fmt.Sprintf("```bash\n%s\n```", pr.URL)
	//
	// 		// Use the cache for markdown rendering
	// 		renderedContent := p.GetOrSetMarkdown(p.permission.ID, func() (string, error) {
	// 			r := styles.GetMarkdownRenderer(p.width - 10)
	// 			s, err := r.Render(content)
	//      return s
	// 		})
	//
	// 		finalContent := baseStyle.
	// 			Width(p.contentViewPort.Width).
	// 			Render(renderedContent)
	// 		p.contentViewPort.SetContent(finalContent)
	// 		return p.styleViewport()
	// 	}
	return ""
}

func (p *permissionDialogComponent) renderDefaultContent() string {
	// 	t := theme.CurrentTheme()
	// 	baseStyle := styles.BaseStyle()
	//
	// 	content := p.permission.Description
	//
	// 	// Use the cache for markdown rendering
	// 	renderedContent := p.GetOrSetMarkdown(p.permission.ID, func() (string, error) {
	// 		r := styles.GetMarkdownRenderer(p.width - 10)
	// 		s, err := r.Render(content)
	//    return s
	// 	})
	//
	// 	finalContent := baseStyle.
	// 		Width(p.contentViewPort.Width).
	// 		Render(renderedContent)
	// 	p.contentViewPort.SetContent(finalContent)
	//
	// 	if renderedContent == "" {
	// 		return ""
	// 	}
	//
	return p.styleViewport()
}

func (p *permissionDialogComponent) styleViewport() string {
	t := theme.CurrentTheme()
	contentStyle := styles.NewStyle().Background(t.Background())

	return contentStyle.Render(p.contentViewPort.View())
}

func (p *permissionDialogComponent) render() string {
	return "NOT IMPLEMENTED"
	// t := theme.CurrentTheme()
	// baseStyle := styles.BaseStyle()
	//
	// title := baseStyle.
	// 	Bold(true).
	// 	Width(p.width - 4).
	// 	Foreground(t.Primary()).
	// 	Render("Permission Required")
	// // Render header
	// headerContent := p.renderHeader()
	// // Render buttons
	// buttons := p.renderButtons()
	//
	// // Calculate content height dynamically based on window size
	// p.contentViewPort.Height = p.height - lipgloss.Height(headerContent) - lipgloss.Height(buttons) - 2 - lipgloss.Height(title)
	// p.contentViewPort.Width = p.width - 4
	//
	// // Render content based on tool type
	// var contentFinal string
	// switch p.permission.ToolName {
	// case "bash":
	// 	contentFinal = p.renderBashContent()
	// case "edit":
	// 	contentFinal = p.renderEditContent()
	// case "patch":
	// 	contentFinal = p.renderPatchContent()
	// case "write":
	// 	contentFinal = p.renderWriteContent()
	// case "fetch":
	// 	contentFinal = p.renderFetchContent()
	// default:
	// 	contentFinal = p.renderDefaultContent()
	// }
	//
	// content := lipgloss.JoinVertical(
	// 	lipgloss.Top,
	// 	title,
	// 	baseStyle.Render(strings.Repeat(" ", lipgloss.Width(title))),
	// 	headerContent,
	// 	contentFinal,
	// 	buttons,
	// 	baseStyle.Render(strings.Repeat(" ", p.width-4)),
	// )
	//
	// return baseStyle.
	// 	Padding(1, 0, 0, 1).
	// 	Border(lipgloss.RoundedBorder()).
	// 	BorderBackground(t.Background()).
	// 	BorderForeground(t.TextMuted()).
	// 	Width(p.width).
	// 	Height(p.height).
	// 	Render(
	// 		content,
	// 	)
}

func (p *permissionDialogComponent) View() string {
	return p.render()
}

func (p *permissionDialogComponent) SetSize() tea.Cmd {
	// if p.permission.ID == "" {
	// 	return nil
	// }
	// switch p.permission.ToolName {
	// case "bash":
	// 	p.width = int(float64(p.windowSize.Width) * 0.4)
	// 	p.height = int(float64(p.windowSize.Height) * 0.3)
	// case "edit":
	// 	p.width = int(float64(p.windowSize.Width) * 0.8)
	// 	p.height = int(float64(p.windowSize.Height) * 0.8)
	// case "write":
	// 	p.width = int(float64(p.windowSize.Width) * 0.8)
	// 	p.height = int(float64(p.windowSize.Height) * 0.8)
	// case "fetch":
	// 	p.width = int(float64(p.windowSize.Width) * 0.4)
	// 	p.height = int(float64(p.windowSize.Height) * 0.3)
	// default:
	// 	p.width = int(float64(p.windowSize.Width) * 0.7)
	// 	p.height = int(float64(p.windowSize.Height) * 0.5)
	// }
	return nil
}

// func (p *permissionDialogCmp) SetPermissions(permission permission.PermissionRequest) tea.Cmd {
// 	p.permission = permission
// 	return p.SetSize()
// }

// Helper to get or set cached diff content
func (c *permissionDialogComponent) GetOrSetDiff(key string, generator func() (string, error)) string {
	if cached, ok := c.diffCache[key]; ok {
		return cached
	}

	content, err := generator()
	if err != nil {
		return fmt.Sprintf("Error formatting diff: %v", err)
	}

	c.diffCache[key] = content

	return content
}

// Helper to get or set cached markdown content
func (c *permissionDialogComponent) GetOrSetMarkdown(key string, generator func() (string, error)) string {
	if cached, ok := c.markdownCache[key]; ok {
		return cached
	}

	content, err := generator()
	if err != nil {
		return fmt.Sprintf("Error rendering markdown: %v", err)
	}

	c.markdownCache[key] = content

	return content
}

func NewPermissionDialogCmp() PermissionDialogComponent {
	// Create viewport for content
	contentViewport := viewport.New() // (0, 0)

	return &permissionDialogComponent{
		contentViewPort: contentViewport,
		selectedOption:  0, // Default to "Allow"
		diffCache:       make(map[string]string),
		markdownCache:   make(map[string]string),
	}
}
