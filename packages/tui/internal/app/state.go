package app

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

type ModelUsage struct {
	ProviderID string    `toml:"provider_id"`
	ModelID    string    `toml:"model_id"`
	LastUsed   time.Time `toml:"last_used"`
}

type AgentUsage struct {
	AgentName string    `toml:"agent_name"`
	LastUsed  time.Time `toml:"last_used"`
}

type AgentModel struct {
	ProviderID string `toml:"provider_id"`
	ModelID    string `toml:"model_id"`
}

type State struct {
	Theme              string                `toml:"theme"`
	AgentModel         map[string]AgentModel `toml:"agent_model"`
	Provider           string                `toml:"provider"`
	Model              string                `toml:"model"`
	Agent              string                `toml:"agent"`
	RecentlyUsedModels []ModelUsage          `toml:"recently_used_models"`
	RecentlyUsedAgents []AgentUsage          `toml:"recently_used_agents"`
	MessageHistory     []Prompt              `toml:"message_history"`
	ShowToolDetails    *bool                 `toml:"show_tool_details"`
	ShowThinkingBlocks *bool                 `toml:"show_thinking_blocks"`
}

func NewState() *State {
	return &State{
		Theme:              "opencode",
		Agent:              "build",
		AgentModel:         make(map[string]AgentModel),
		RecentlyUsedModels: make([]ModelUsage, 0),
		RecentlyUsedAgents: make([]AgentUsage, 0),
		MessageHistory:     make([]Prompt, 0),
	}
}

// UpdateModelUsage updates the recently used models list with the specified model
func (s *State) UpdateModelUsage(providerID, modelID string) {
	now := time.Now()

	// Check if this model is already in the list
	for i, usage := range s.RecentlyUsedModels {
		if usage.ProviderID == providerID && usage.ModelID == modelID {
			s.RecentlyUsedModels[i].LastUsed = now
			usage := s.RecentlyUsedModels[i]
			copy(s.RecentlyUsedModels[1:i+1], s.RecentlyUsedModels[0:i])
			s.RecentlyUsedModels[0] = usage
			return
		}
	}

	newUsage := ModelUsage{
		ProviderID: providerID,
		ModelID:    modelID,
		LastUsed:   now,
	}

	// Prepend to slice and limit to last 50 entries
	s.RecentlyUsedModels = append([]ModelUsage{newUsage}, s.RecentlyUsedModels...)
	if len(s.RecentlyUsedModels) > 50 {
		s.RecentlyUsedModels = s.RecentlyUsedModels[:50]
	}
}

func (s *State) RemoveModelFromRecentlyUsed(providerID, modelID string) {
	for i, usage := range s.RecentlyUsedModels {
		if usage.ProviderID == providerID && usage.ModelID == modelID {
			s.RecentlyUsedModels = append(s.RecentlyUsedModels[:i], s.RecentlyUsedModels[i+1:]...)
			return
		}
	}
}

// UpdateAgentUsage updates the recently used agents list with the specified agent
func (s *State) UpdateAgentUsage(agentName string) {
	now := time.Now()

	// Check if this agent is already in the list
	for i, usage := range s.RecentlyUsedAgents {
		if usage.AgentName == agentName {
			s.RecentlyUsedAgents[i].LastUsed = now
			usage := s.RecentlyUsedAgents[i]
			copy(s.RecentlyUsedAgents[1:i+1], s.RecentlyUsedAgents[0:i])
			s.RecentlyUsedAgents[0] = usage
			return
		}
	}

	newUsage := AgentUsage{
		AgentName: agentName,
		LastUsed:  now,
	}

	// Prepend to slice and limit to last 20 entries
	s.RecentlyUsedAgents = append([]AgentUsage{newUsage}, s.RecentlyUsedAgents...)
	if len(s.RecentlyUsedAgents) > 20 {
		s.RecentlyUsedAgents = s.RecentlyUsedAgents[:20]
	}
}

func (s *State) RemoveAgentFromRecentlyUsed(agentName string) {
	for i, usage := range s.RecentlyUsedAgents {
		if usage.AgentName == agentName {
			s.RecentlyUsedAgents = append(s.RecentlyUsedAgents[:i], s.RecentlyUsedAgents[i+1:]...)
			return
		}
	}
}

func (s *State) AddPromptToHistory(prompt Prompt) {
	s.MessageHistory = append([]Prompt{prompt}, s.MessageHistory...)
	if len(s.MessageHistory) > 50 {
		s.MessageHistory = s.MessageHistory[:50]
	}
}

// SaveState writes the provided Config struct to the specified TOML file.
// It will create the file if it doesn't exist, or overwrite it if it does.
func SaveState(filePath string, state *State) error {
	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create/open config file %s: %w", filePath, err)
	}
	defer file.Close()

	writer := bufio.NewWriter(file)
	encoder := toml.NewEncoder(writer)
	if err := encoder.Encode(state); err != nil {
		return fmt.Errorf("failed to encode state to TOML file %s: %w", filePath, err)
	}
	if err := writer.Flush(); err != nil {
		return fmt.Errorf("failed to flush writer for state file %s: %w", filePath, err)
	}

	slog.Debug("State saved to file", "file", filePath)
	return nil
}

// LoadState loads the state from the specified TOML file.
// It returns a pointer to the State struct and an error if any issues occur.
func LoadState(filePath string) (*State, error) {
	var state State
	if _, err := toml.DecodeFile(filePath, &state); err != nil {
		if _, statErr := os.Stat(filePath); os.IsNotExist(statErr) {
			return nil, fmt.Errorf("state file not found at %s: %w", filePath, statErr)
		}
		return nil, fmt.Errorf("failed to decode TOML from file %s: %w", filePath, err)
	}

	// Restore attachment sources types that were deserialized as map[string]any
	for _, prompt := range state.MessageHistory {
		for _, att := range prompt.Attachments {
			att.RestoreSourceType()
		}
	}

	return &state, nil
}
