package config

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"

	"github.com/BurntSushi/toml"
	"github.com/sst/opencode/pkg/client"
)

type State struct {
	Theme    string `toml:"theme"`
	Provider string `toml:"provider"`
	Model    string `toml:"model"`
}

func NewState() *State {
	return &State{
		Theme: "system",
	}
}

func MergeState(state *State, config *client.ConfigInfo) *client.ConfigInfo {
	if config.Theme == nil {
		config.Theme = &state.Theme
	}
	return config
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
