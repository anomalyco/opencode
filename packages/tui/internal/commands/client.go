package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// CustomCommand represents a custom command from the server
type CustomCommand struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Content     string  `json:"content"`
	FilePath    string  `json:"filePath"`
	IsGlobal    bool    `json:"isGlobal"`
}

// ExecuteCommandRequest represents the request to execute a command
type ExecuteCommandRequest struct {
	Arguments *string `json:"arguments,omitempty"`
}

// BashResult represents the result of a bash command execution
type BashResult struct {
	Command  string `json:"command"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

// ExecuteCommandResponse represents the response from executing a command
type ExecuteCommandResponse struct {
	ProcessedContent string       `json:"processedContent"`
	BashResults      []BashResult `json:"bashResults"`
}

// CommandsClient handles communication with the server for custom commands
type CommandsClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewCommandsClient creates a new commands client
func NewCommandsClient(baseURL string) *CommandsClient {
	return &CommandsClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ListCustomCommands fetches all available custom commands from the server
func (c *CommandsClient) ListCustomCommands(ctx context.Context) ([]CustomCommand, error) {
	url := fmt.Sprintf("%s/commands", c.baseURL)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	var commands []CustomCommand
	if err := json.NewDecoder(resp.Body).Decode(&commands); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return commands, nil
}

// GetCustomCommand fetches a specific custom command from the server
func (c *CommandsClient) GetCustomCommand(ctx context.Context, name string) (*CustomCommand, error) {
	url := fmt.Sprintf("%s/commands/%s", c.baseURL, name)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // Command not found
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	var command CustomCommand
	if err := json.NewDecoder(resp.Body).Decode(&command); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &command, nil
}

// ExecuteCustomCommand executes a custom command on the server
func (c *CommandsClient) ExecuteCustomCommand(ctx context.Context, name string, arguments *string) (*ExecuteCommandResponse, error) {
	url := fmt.Sprintf("%s/commands/%s/execute", c.baseURL, name)

	reqBody := ExecuteCommandRequest{
		Arguments: arguments,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		var errorResp struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &errorResp) == nil {
			return nil, fmt.Errorf("%s", errorResp.Error)
		}
		return nil, fmt.Errorf("command not found")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	var result ExecuteCommandResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// CustomCommandExists checks if a custom command exists on the server
func (c *CommandsClient) CustomCommandExists(ctx context.Context, name string) (bool, error) {
	command, err := c.GetCustomCommand(ctx, name)
	if err != nil {
		return false, err
	}
	return command != nil, nil
}
