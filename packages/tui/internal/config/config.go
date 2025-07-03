package config

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

type State struct {
	Theme              string       `toml:"theme"`
	Provider           string       `toml:"provider"`
	Model              string       `toml:"model"`
	RecentlyUsedModels []ModelUsage `toml:"recently_used_models"`
	MessagesRight      bool         `toml:"messages_right"`
	SplitDiff          bool         `toml:"split_diff"`
}

func NewState() *State {
	return &State{
		Theme:              "opencode",
		RecentlyUsedModels: make([]ModelUsage, 0),
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
	return &state, nil
}
