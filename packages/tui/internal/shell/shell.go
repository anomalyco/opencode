package shell

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// SharedShell is a singleton shell instance that maintains state across the application
type SharedShell struct {
	mu  sync.Mutex
	cwd string
	env map[string]string
}

var (
	instance *SharedShell
	once     sync.Once
)

// GetSharedShell returns the singleton shell instance
func GetSharedShell() *SharedShell {
	once.Do(func() {
		cwd, _ := os.Getwd()
		instance = &SharedShell{
			cwd: cwd,
			env: make(map[string]string),
		}
		// Initialize environment from current process
		for _, e := range os.Environ() {
			if i := strings.Index(e, "="); i >= 0 {
				instance.env[e[:i]] = e[i+1:]
			}
		}
	})
	return instance
}

// GetWorkingDir returns the current working directory
func (s *SharedShell) GetWorkingDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cwd
}

// SetWorkingDir sets the working directory
func (s *SharedShell) SetWorkingDir(dir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Expand ~ to home directory
	if strings.HasPrefix(dir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dir = filepath.Join(home, dir[2:])
	}
	
	// Resolve to absolute path
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	
	// Verify the directory exists
	if _, err := os.Stat(absDir); err != nil {
		return fmt.Errorf("directory does not exist: %w", err)
	}
	
	s.cwd = absDir
	return nil
}

// IsCommand checks if a string is a valid shell command using "command -v"
func (s *SharedShell) IsCommand(input string) bool {
	// Split the input to get the first word (the command)
	parts := strings.Fields(input)
	if len(parts) == 0 {
		return false
	}
	
	cmd := parts[0]
	
	// Handle shell built-ins that won't be found by "command -v"
	builtins := []string{"cd", "pwd", "export", "unset", "alias", "unalias", "echo", "source", ".", "eval", "set"}
	for _, builtin := range builtins {
		if cmd == builtin {
			return true
		}
	}
	
	// Use "command -v" to check if it's a valid command
	s.mu.Lock()
	defer s.mu.Unlock()
	
	var checkCmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// On Windows, use where command
		checkCmd = exec.Command("where", cmd)
	} else {
		// On Unix-like systems, use command -v
		checkCmd = exec.Command("sh", "-c", fmt.Sprintf("command -v %s", cmd))
	}
	
	checkCmd.Dir = s.cwd
	checkCmd.Env = s.buildEnv()
	
	err := checkCmd.Run()
	return err == nil
}

// Execute runs a shell command and returns stdout, stderr, and error
func (s *SharedShell) Execute(ctx context.Context, command string) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Handle cd command specially to update the working directory
	trimmed := strings.TrimSpace(command)
	if strings.HasPrefix(trimmed, "cd ") || trimmed == "cd" {
		return s.handleCd(trimmed)
	}
	
	// Handle pwd command
	if trimmed == "pwd" {
		return s.cwd + "\n", "", nil
	}
	
	// Handle export command
	if strings.HasPrefix(trimmed, "export ") {
		return s.handleExport(trimmed)
	}
	
	// Handle unset command
	if strings.HasPrefix(trimmed, "unset ") {
		return s.handleUnset(trimmed)
	}
	
	// Execute other commands
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/c", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}
	
	cmd.Dir = s.cwd
	cmd.Env = s.buildEnv()
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Try to separate stderr if possible
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", string(output), exitErr
		}
		return "", string(output), err
	}
	
	return string(output), "", nil
}

// handleCd handles the cd command and updates the working directory
func (s *SharedShell) handleCd(command string) (string, string, error) {
	parts := strings.Fields(command)
	var targetDir string
	
	if len(parts) == 1 {
		// cd with no arguments goes to home directory
		home, err := os.UserHomeDir()
		if err != nil {
			return "", "", err
		}
		targetDir = home
	} else {
		targetDir = strings.Join(parts[1:], " ")
	}
	
	// Handle ~ expansion
	if strings.HasPrefix(targetDir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", "", err
		}
		targetDir = filepath.Join(home, targetDir[2:])
	}
	
	// Handle relative paths
	if !filepath.IsAbs(targetDir) {
		targetDir = filepath.Join(s.cwd, targetDir)
	}
	
	// Clean the path
	targetDir = filepath.Clean(targetDir)
	
	// Verify the directory exists
	if _, err := os.Stat(targetDir); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Sprintf("cd: %s: No such file or directory\n", targetDir), err
		}
		return "", "", err
	}
	
	s.cwd = targetDir
	return "", "", nil
}

// handleExport handles the export command
func (s *SharedShell) handleExport(command string) (string, string, error) {
	parts := strings.SplitN(command, " ", 2)
	if len(parts) < 2 {
		return "", "export: not enough arguments\n", fmt.Errorf("export requires arguments")
	}
	
	// Parse the export statement
	exportStr := strings.TrimSpace(parts[1])
	eqIndex := strings.Index(exportStr, "=")
	
	if eqIndex < 0 {
		// Just print the variable value if no = sign
		if val, ok := s.env[exportStr]; ok {
			return fmt.Sprintf("%s=%s\n", exportStr, val), "", nil
		}
		return "", "", nil
	}
	
	key := exportStr[:eqIndex]
	value := exportStr[eqIndex+1:]
	
	// Remove quotes if present
	value = strings.Trim(value, "\"'")
	
	s.env[key] = value
	return "", "", nil
}

// handleUnset handles the unset command
func (s *SharedShell) handleUnset(command string) (string, string, error) {
	parts := strings.Fields(command)
	if len(parts) < 2 {
		return "", "unset: not enough arguments\n", fmt.Errorf("unset requires arguments")
	}
	
	for i := 1; i < len(parts); i++ {
		delete(s.env, parts[i])
	}
	
	return "", "", nil
}

// buildEnv builds the environment variable list for command execution
func (s *SharedShell) buildEnv() []string {
	env := make([]string, 0, len(s.env))
	for k, v := range s.env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	return env
}

// GetEnv returns the value of an environment variable
func (s *SharedShell) GetEnv(key string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.env[key]
}

// SetEnv sets an environment variable
func (s *SharedShell) SetEnv(key, value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.env[key] = value
}