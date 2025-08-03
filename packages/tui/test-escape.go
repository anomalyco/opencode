package main

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea/v2"
	"os"
)

type model struct {
	lastKey string
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		m.lastKey = msg.String()
		if m.lastKey == "q" || m.lastKey == "ctrl+c" {
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	return fmt.Sprintf("Last key pressed: %q\nPress 'q' to quit\n", m.lastKey)
}

func main() {
	p := tea.NewProgram(model{})
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error: %v", err)
		os.Exit(1)
	}
}