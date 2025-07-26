package dialog

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// PermissionDialog interface for the permission request dialog
type PermissionDialog interface {
	layout.Modal
}

type permissionDialog struct {
	width         int
	height        int
	modal         *modal.Modal
	app           *app.App
	permissionID  string
	sessionID     string
	title         string
	metadata      map[string]interface{}
	selectedIndex int // 0 = Allow Once, 1 = Allow Always, 2 = Deny
}

// PermissionDialogCloseMsg is sent when the permission dialog is closed
type PermissionDialogCloseMsg struct{}

func (p *permissionDialog) Init() tea.Cmd {
	return nil
}

func (p *permissionDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		p.width = msg.Width
		p.height = msg.Height
	case tea.KeyPressMsg:
		switch msg.String() {
		case "up", "k":
			if p.selectedIndex > 0 {
				p.selectedIndex--
			}
		case "down", "j":
			if p.selectedIndex < 2 {
				p.selectedIndex++
			}
		case "enter":
			// Map selected index to response
			var response string
			switch p.selectedIndex {
			case 0:
				response = "once"
			case 1:
				response = "always"
			case 2:
				response = "reject"
			}
			
			// Send permission response
			return p, tea.Sequence(
				p.respondToPermission(response),
				util.CmdHandler(PermissionDialogCloseMsg{}),
			)
		case "esc":
			// Escape means reject
			return p, tea.Sequence(
				p.respondToPermission("reject"),
				util.CmdHandler(PermissionDialogCloseMsg{}),
			)
		case "1":
			p.selectedIndex = 0
		case "2":
			p.selectedIndex = 1
		case "3":
			p.selectedIndex = 2
		}
	}

	return p, nil
}

func (p *permissionDialog) View() string {
	t := theme.CurrentTheme()
	
	// Create option styles
	normalStyle := styles.NewStyle().
		Foreground(t.Text()).
		PaddingLeft(2).
		PaddingRight(2)
	
	selectedStyle := styles.NewStyle().
		Background(t.Primary()).
		Foreground(t.BackgroundElement()).
		Bold(true).
		PaddingLeft(2).
		PaddingRight(2)
	
	dangerStyle := styles.NewStyle().
		Foreground(t.Error()).
		PaddingLeft(2).
		PaddingRight(2)
		
	dangerSelectedStyle := styles.NewStyle().
		Background(t.Error()).
		Foreground(t.BackgroundElement()).
		Bold(true).
		PaddingLeft(2).
		PaddingRight(2)

	// Build content
	var content strings.Builder
	
	// Title and description
	content.WriteString(styles.NewStyle().
		Foreground(t.Text()).
		Bold(true).
		Render(p.title))
	content.WriteString("\n\n")
	
	// Show command if available
	if cmd, ok := p.metadata["command"].(string); ok && cmd != "" {
		content.WriteString(styles.NewStyle().
			Foreground(t.TextMuted()).
			Render("Command: "))
		content.WriteString(styles.NewStyle().
			Foreground(t.Text()).
			Background(t.BackgroundPanel()).
			Render(" " + cmd + " "))
		content.WriteString("\n\n")
	}
	
	content.WriteString("Choose an option:\n\n")
	
	// Option 1: Allow Once
	if p.selectedIndex == 0 {
		content.WriteString(selectedStyle.Render("► 1. Allow Once"))
	} else {
		content.WriteString(normalStyle.Render("  1. Allow Once"))
	}
	content.WriteString("\n")
	
	// Option 2: Allow Always
	if p.selectedIndex == 1 {
		content.WriteString(selectedStyle.Render("► 2. Allow Always"))
	} else {
		content.WriteString(normalStyle.Render("  2. Allow Always"))
	}
	content.WriteString("\n")
	
	// Option 3: Deny
	if p.selectedIndex == 2 {
		content.WriteString(dangerSelectedStyle.Render("► 3. Deny"))
	} else {
		content.WriteString(dangerStyle.Render("  3. Deny"))
	}
	content.WriteString("\n\n")
	
	// Help text
	content.WriteString(styles.NewStyle().
		Foreground(t.TextMuted()).
		Render("Use ↑/↓ or numbers to select, Enter to confirm, Esc to deny"))

	return content.String()
}

func (p *permissionDialog) Render(background string) string {
	return p.modal.Render(p.View(), background)
}

func (p *permissionDialog) Close() tea.Cmd {
	return nil
}

func (p *permissionDialog) respondToPermission(response string) tea.Cmd {
	return func() tea.Msg {
		// TODO: Implement permission response API
		// For now, just log the response and continue
		// This will be implemented when the permission API endpoint is added
		return nil
	}
}

// NewPermissionDialog creates a new permission request dialog
func NewPermissionDialog(app *app.App, properties opencode.EventListResponseEventPermissionUpdatedProperties) PermissionDialog {
	return &permissionDialog{
		app:           app,
		permissionID:  properties.ID,
		sessionID:     properties.SessionID,
		title:         properties.Title,
		metadata:      properties.Metadata,
		selectedIndex: 0, // Default to "Allow Once"
		modal: modal.New(
			modal.WithTitle("Permission Required"),
			modal.WithMaxWidth(60),
		),
	}
}