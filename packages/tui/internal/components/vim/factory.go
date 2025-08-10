package vim

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/textarea"
)

// TextAreaInterface defines the common interface for text areas
type TextAreaInterface interface {
	Value() string
	SetValue(string)
	Focus() tea.Cmd
	Blur()
	GetAttachments() []any
	SetAttachment(any)
	InsertRunesFromUserInput([]rune)
	Update(tea.Msg) (tea.Model, tea.Cmd)
}

// TextAreaWrapper wraps a regular textarea to implement TextAreaInterface
type TextAreaWrapper struct {
	Model *textarea.Model
}

func (w *TextAreaWrapper) Value() string {
	return w.Model.Value()
}

func (w *TextAreaWrapper) SetValue(v string) {
	w.Model.SetValue(v)
}

func (w *TextAreaWrapper) Focus() tea.Cmd {
	return w.Model.Focus()
}

func (w *TextAreaWrapper) Blur() {
	w.Model.Blur()
}

func (w *TextAreaWrapper) GetAttachments() []any {
	attachments := w.Model.GetAttachments()
	result := make([]any, len(attachments))
	for i, a := range attachments {
		result[i] = a
	}
	return result
}

func (w *TextAreaWrapper) SetAttachment(a any) {
	// Model doesn't have SetAttachment, only InsertAttachment
	// This is handled differently in the actual implementation
}

func (w *TextAreaWrapper) InsertRunesFromUserInput(r []rune) {
	w.Model.InsertRunesFromUserInput(r)
}

func (w *TextAreaWrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Model.Update returns (Model, Cmd) not (*Model, Cmd)
	var cmd tea.Cmd
	updatedModel, cmd := w.Model.Update(msg)
	*w.Model = updatedModel
	return w, cmd
}

func (w *TextAreaWrapper) Init() tea.Cmd {
	return nil // textarea.Model doesn't have Init
}

func (w *TextAreaWrapper) View() string {
	return w.Model.View()
}

// TextAreaFactory creates the appropriate text area based on configuration
type TextAreaFactory struct {
	app            *app.App
	useVim         bool
	regular        textarea.Model
	regularWrapper *TextAreaWrapper
	vim            *VimTextarea
}

// NewTextAreaFactory creates a new text area factory
func NewTextAreaFactory(app *app.App) *TextAreaFactory {
	// Create regular textarea
	ta := textarea.New()
	ta.Prompt = " "
	ta.ShowLineNumbers = false
	ta.CharLimit = -1

	// Create vim textarea
	vta := NewVimTextarea()
	vta.Model.Prompt = " "
	vta.Model.ShowLineNumbers = false
	vta.Model.CharLimit = -1

	// Check configuration
	useVim := false
	// Note: Config.Vim doesn't exist yet in the SDK
	// This would be enabled via a future configuration update
	// if app.Config != nil && app.Config.Vim != nil && app.Config.Vim.Enabled {
	//     useVim = true
	//     vta.EnableVimMode()
	// }

	return &TextAreaFactory{
		app:            app,
		useVim:         useVim,
		regular:        ta,
		regularWrapper: &TextAreaWrapper{Model: &ta},
		vim:            vta,
	}
}

// Current returns the currently active text area
func (f *TextAreaFactory) Current() TextAreaInterface {
	if f.useVim {
		return f.vim
	}
	return f.regularWrapper
}

// Update handles the update for the current textarea
func (f *TextAreaFactory) Update(msg tea.Msg) tea.Cmd {
	if f.useVim {
		_, cmd := f.vim.Update(msg)
		return cmd
	}
	_, cmd := f.regularWrapper.Update(msg)
	return cmd
}

// ToggleVimMode switches between regular and vim mode
func (f *TextAreaFactory) ToggleVimMode() {
	if f.useVim {
		// Switching from vim to regular
		currentValue := f.vim.Value()
		f.useVim = false
		f.vim.DisableVimMode()
		// Copy content from vim to regular
		f.regular.SetValue(currentValue)
		f.regularWrapper.Model = &f.regular
		f.regular.Focus()
	} else {
		// Switching from regular to vim
		// Get the current value from the wrapper (which has the most up-to-date state)
		currentValue := f.regularWrapper.Value()
		f.useVim = true
		f.vim.EnableVimMode()
		// Copy content from regular to vim
		f.vim.SetValue(currentValue)
		f.vim.Focus()
	}

	// Update configuration in memory
	// Note: Config.Vim doesn't exist yet in the SDK
	// if f.app.Config != nil {
	//     if f.app.Config.Vim == nil {
	//         f.app.Config.Vim = &opencode.ConfigVim{}
	//     }
	//     f.app.Config.Vim.Enabled = f.useVim
	// }
}

// IsVimMode returns whether vim mode is currently active
func (f *TextAreaFactory) IsVimMode() bool {
	return f.useVim
}

// GetVimStatusLine returns the vim status line if vim mode is active
func (f *TextAreaFactory) GetVimStatusLine() string {
	if f.useVim {
		return f.vim.GetVimStatusLine()
	}
	return ""
}

// GetVimModeString returns the current vim mode as a string
func (f *TextAreaFactory) GetVimModeString() string {
	if f.useVim && f.vim.vimMode != nil {
		return f.vim.vimMode.CurrentMode().String()
	}
	return ""
}

// UpdateStyles applies the provided style update function to both text areas
func (f *TextAreaFactory) UpdateStyles(updateFunc func(textarea.Model) textarea.Model) {
	f.regular = updateFunc(f.regular)
	f.regularWrapper.Model = &f.regular
	*f.vim.Model = updateFunc(*f.vim.Model)
}
