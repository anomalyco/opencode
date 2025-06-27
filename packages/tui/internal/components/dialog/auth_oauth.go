package dialog

import (
	"context"
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	"github.com/charmbracelet/bubbles/v2/spinner"
	"github.com/charmbracelet/bubbles/v2/textinput"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/modal"
	"github.com/sst/opencode/internal/components/toast"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/sst/opencode/pkg/client"
)

// AuthOAuthDialog handles OAuth authentication flow
type AuthOAuthDialog interface {
	layout.Modal
}

type authOAuthDialog struct {
	app             *app.App
	provider        AuthProviderInfo
	modal           *modal.Modal
	state           oauthState
	authURL         string
	deviceCode      string
	userCode        string
	pollInterval    int
	spinner         spinner.Model
	codeInput       textinput.Model
	showAnthropicInput bool
}

type oauthState int

const (
	oauthStateInit oauthState = iota
	oauthStateWaitingForAuth
	oauthStateAnthropicCode
	oauthStatePolling
	oauthStateSuccess
	oauthStateError
)

type authOAuthKeyMap struct {
	Enter  key.Binding
	Copy   key.Binding
	Escape key.Binding
}

var authOAuthKeys = authOAuthKeyMap{
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "submit"),
	),
	Copy: key.NewBinding(
		key.WithKeys("c"),
		key.WithHelp("c", "copy URL"),
	),
	Escape: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
}

type pollTickMsg time.Time

type oauthStartResponse struct {
	url, verifier, deviceCode string
	interval                  int
}

func (d *authOAuthDialog) Init() tea.Cmd {
	return tea.Batch(
		d.startOAuth(), 
		d.spinner.Tick,
		// Add a timeout for the initial auth request
		tea.Tick(10*time.Second, func(t time.Time) tea.Msg {
			if d.state == oauthStateInit {
				return fmt.Errorf("authentication request timed out")
			}
			return nil
		}),
	)
}

func (d *authOAuthDialog) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch d.state {
		case oauthStateWaitingForAuth:
			switch {
			case key.Matches(msg, authOAuthKeys.Copy):
				return d, tea.SetClipboard(d.authURL)
			case key.Matches(msg, authOAuthKeys.Escape):
				return d, util.CmdHandler(modal.CloseModalMsg{})
			}
			
		case oauthStateAnthropicCode:
			switch {
			case key.Matches(msg, authOAuthKeys.Enter):
				code := d.codeInput.Value()
				if code != "" {
					d.state = oauthStatePolling
					return d, d.exchangeAnthropicCode(code)
				}
			case key.Matches(msg, authOAuthKeys.Escape):
				return d, util.CmdHandler(modal.CloseModalMsg{})
			}
			
		case oauthStatePolling, oauthStateSuccess:
			if key.Matches(msg, authOAuthKeys.Escape) {
				return d, util.CmdHandler(modal.CloseModalMsg{})
			}
		}
		
	case pollTickMsg:
		if d.state == oauthStatePolling && d.provider.Id == "github-copilot" {
			return d, d.pollDeviceAuth()
		}
		
	case spinner.TickMsg:
		d.spinner, cmd = d.spinner.Update(msg)
		cmds = append(cmds, cmd)
		
	case AuthSuccessMsg:
		d.state = oauthStateSuccess
		// Close immediately and forward the success message
		return d, tea.Sequence(
			util.CmdHandler(modal.CloseModalMsg{}),
			util.CmdHandler(msg), // Forward the AuthSuccessMsg
		)
		
	case error:
		d.state = oauthStateError
		return d, toast.NewErrorToast(fmt.Sprintf("Authentication failed: %s", msg.Error()))
		
	case oauthStartResponse:
		// OAuth start response
		d.authURL = msg.url
		d.userCode = msg.verifier
		d.deviceCode = msg.deviceCode
		d.pollInterval = msg.interval
		
		if d.provider.Id == "anthropic" {
			// Anthropic needs code input after visiting URL
			d.state = oauthStateAnthropicCode
			d.showAnthropicInput = true
			d.codeInput.Focus()
			cmds = append(cmds, textinput.Blink)
		} else if d.provider.Id == "github-copilot" {
			// GitHub Copilot uses device flow
			d.state = oauthStateWaitingForAuth
			if d.userCode != "" { // userCode contains the user verification code
				d.state = oauthStatePolling
				interval := d.pollInterval
				if interval == 0 {
					interval = 5 // default
				}
				cmds = append(cmds, tea.Tick(time.Duration(interval)*time.Second, func(t time.Time) tea.Msg {
					return pollTickMsg(t)
				}))
			}
		} else {
			// For other OAuth providers, just show the URL
			d.state = oauthStateWaitingForAuth
		}
		
		// Try to copy URL to clipboard
		cmds = append(cmds, tea.SetClipboard(d.authURL))
	}

	if d.showAnthropicInput {
		d.codeInput, cmd = d.codeInput.Update(msg)
		cmds = append(cmds, cmd)
	}

	return d, tea.Batch(cmds...)
}

func (d *authOAuthDialog) startOAuth() tea.Cmd {
	return func() tea.Msg {
		resp, err := d.app.Client.PostAuthStartWithResponse(
			context.Background(),
			client.PostAuthStartJSONRequestBody{
				ProviderId: d.provider.Id,
			},
		)
		
		if err != nil {
			return err
		}
		
		if resp.StatusCode() != 200 {
			return fmt.Errorf("failed with status %d", resp.StatusCode())
		}
		
		if resp.JSON200 == nil {
			return fmt.Errorf("empty response from auth start")
		}
		
		result := oauthStartResponse{
			url: resp.JSON200.Url,
		}
		
		// Check if URL is empty
		if result.url == "" {
			return fmt.Errorf("no authentication URL provided")
		}
		
		// Extract verifier if present
		if resp.JSON200.Verifier != nil {
			result.verifier = *resp.JSON200.Verifier
		}
		
		// For GitHub Copilot, the verifier field contains the user code to display
		// We'll need to extract deviceCode from the raw response if needed
		if d.provider.Id == "github-copilot" {
			// The verifier contains the user code to display to the user
			// For polling, we can try using the verifier as the device code
			result.deviceCode = result.verifier
			result.interval = 5 // default polling interval
		}
		
		return result
	}
}

func (d *authOAuthDialog) exchangeAnthropicCode(code string) tea.Cmd {
	return func() tea.Msg {
		resp, err := d.app.Client.PostAuthExchangeWithResponse(
			context.Background(),
			client.PostAuthExchangeJSONRequestBody{
				ProviderId: d.provider.Id,
				Code:       code,
				Verifier:   &d.userCode,
			},
		)
		
		if err != nil {
			return err
		}
		
		if resp.StatusCode() != 200 {
			return fmt.Errorf("invalid authorization code")
		}
		
		return AuthSuccessMsg{ProviderID: d.provider.Id}
	}
}

func (d *authOAuthDialog) pollDeviceAuth() tea.Cmd {
	return func() tea.Msg {
		// For GitHub Copilot, we need to use the verifier as the device code
		// since the actual deviceCode isn't exposed in the generated client
		deviceCode := d.deviceCode
		if deviceCode == "" && d.provider.Id == "github-copilot" {
			deviceCode = d.userCode // Use verifier as device code
		}
		
		resp, err := d.app.Client.PostAuthPollWithResponse(
			context.Background(),
			client.PostAuthPollJSONRequestBody{
				DeviceCode: deviceCode,
			},
		)
		
		if err != nil {
			return err
		}
		
		if resp.StatusCode() != 200 {
			return fmt.Errorf("polling failed")
		}
		
		switch resp.JSON200.Status {
		case "success":
			return AuthSuccessMsg{ProviderID: d.provider.Id}
		case "failed":
			return fmt.Errorf("authorization failed")
		case "pending":
			// Continue polling
			return tea.Tick(time.Duration(d.pollInterval)*time.Second, func(t time.Time) tea.Msg {
				return pollTickMsg(t)
			})
		}
		
		return nil
	}
}

func (d *authOAuthDialog) View() string {
	t := theme.CurrentTheme()
	var content []string
	
	switch d.state {
	case oauthStateInit:
		content = append(content,
			d.spinner.View()+" Starting authentication...",
		)
		
	case oauthStateWaitingForAuth, oauthStatePolling:
		if d.authURL != "" {
			if d.provider.Id == "github-copilot" && d.userCode != "" {
				content = append(content,
					styles.NewStyle().
						Foreground(t.Text()).
						MarginBottom(1).
						Render("Please visit:"),
					styles.NewStyle().
						Foreground(t.Primary()).
						Bold(true).
						Render(d.authURL),
					"",
					styles.NewStyle().
						Foreground(t.Text()).
						Render("Enter code:"),
					styles.NewStyle().
						Foreground(t.Primary()).
						Bold(true).
						Render(d.userCode),
				)
				
				if d.state == oauthStatePolling {
					content = append(content, "",
						d.spinner.View()+" Waiting for authorization...",
					)
				}
			} else {
				content = append(content,
					styles.NewStyle().
						Foreground(t.Text()).
						MarginBottom(1).
						Render("Please visit this URL to authenticate:"),
					styles.NewStyle().
						Foreground(t.Primary()).
						Bold(true).
						Render(d.authURL),
				)
			}
		} else {
			content = append(content,
				styles.NewStyle().
					Foreground(t.Error()).
					Render("Error: No authentication URL received"),
			)
		}
		
		content = append(content, "",
			styles.NewStyle().
				Foreground(t.TextMuted()).
				Italic(true).
				Render("Press 'c' to copy URL | ESC to cancel"),
		)
		
	case oauthStateAnthropicCode:
		content = append(content,
			styles.NewStyle().
				Foreground(t.Text()).
				MarginBottom(1).
				Render("Visit this URL in your browser:"),
			"",
			// Display URL in a code block style for better visibility
			styles.NewStyle().
				Foreground(t.Primary()).
				Background(t.BackgroundPanel()).
				Padding(1).
				Width(76).
				Render(d.authURL),
			"",
			styles.NewStyle().
				Foreground(t.TextMuted()).
				Italic(true).
				Render("(URL copied to clipboard)"),
			"",
			styles.NewStyle().
				Foreground(t.Text()).
				Render("Then paste the authorization code:"),
			"",
			d.codeInput.View(),
			"",
			styles.NewStyle().
				Foreground(t.TextMuted()).
				Italic(true).
				Render("Press Enter to submit | Ctrl+V to paste"),
		)
		
	case oauthStateSuccess:
		content = append(content,
			styles.NewStyle().
				Foreground(t.Success()).
				Bold(true).
				Render("✓ Authentication successful!"),
		)
		
	case oauthStateError:
		content = append(content,
			styles.NewStyle().
				Foreground(t.Error()).
				Render("Authentication failed"),
		)
	}
	
	return lipgloss.JoinVertical(lipgloss.Left, content...)
}

func (d *authOAuthDialog) Render(background string) string {
	return d.modal.Render(d.View(), background)
}

func (d *authOAuthDialog) Close() tea.Cmd {
	return nil
}

func NewAuthOAuthDialog(app *app.App, provider AuthProviderInfo) AuthOAuthDialog {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(theme.CurrentTheme().Primary())
	
	ti := textinput.New()
	ti.Placeholder = "Paste code here"
	ti.Focus()
	ti.CharLimit = 200
	ti.SetWidth(70)
	ti.Prompt = "> "
	
	title := fmt.Sprintf("Authenticate %s", provider.Name)
	
	return &authOAuthDialog{
		app:       app,
		provider:  provider,
		spinner:   s,
		codeInput: ti,
		state:     oauthStateInit,
		modal: modal.New(
			modal.WithTitle(title),
			modal.WithMaxWidth(80),
		),
	}
}