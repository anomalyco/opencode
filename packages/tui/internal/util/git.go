package util

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// GitInfo holds git repository information
type GitInfo struct {
	Branch     string
	CommitHash string
	IsRepo     bool
}

// GetGitInfo returns comprehensive git information for the current directory
func GetGitInfo() *GitInfo {
	info := &GitInfo{
		IsRepo: IsGitRepository(),
	}

	if !info.IsRepo {
		return info
	}

	if branch, err := GetCurrentBranch(); err == nil {
		info.Branch = branch
	}

	if hash, err := GetShortCommitHash(); err == nil {
		info.CommitHash = hash
	}

	return info
}

// IsGitRepository checks if the current directory is within a git repository
func IsGitRepository() bool {
	cmd := exec.Command("git", "rev-parse", "--git-dir")
	err := cmd.Run()
	return err == nil
}

// GetCurrentBranch returns the current git branch name
func GetCurrentBranch() (string, error) {
	cmd := exec.Command("git", "branch", "--show-current")
	output, err := cmd.Output()
	if err != nil {
		// Fallback for detached HEAD state
		return getDetachedHeadInfo()
	}

	branch := strings.TrimSpace(string(output))
	if branch == "" {
		// Handle detached HEAD or other edge cases
		return getDetachedHeadInfo()
	}

	return branch, nil
}

// getDetachedHeadInfo handles detached HEAD state
func getDetachedHeadInfo() (string, error) {
	cmd := exec.Command("git", "describe", "--tags", "--exact-match")
	if output, err := cmd.Output(); err == nil {
		tag := strings.TrimSpace(string(output))
		if tag != "" {
			return tag, nil
		}
	}

	// Fallback to short commit hash
	cmd = exec.Command("git", "rev-parse", "--short", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return "detached", err
	}

	hash := strings.TrimSpace(string(output))
	return "detached@" + hash, nil
}

// GetShortCommitHash returns the short commit hash (7 characters)
func GetShortCommitHash() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--short=7", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

// ShortenPath shortens a file path for display in the status bar
func ShortenPath(path string, maxLength int) string {
	if len(path) <= maxLength {
		return path
	}

	// Handle home directory replacement
	if strings.HasPrefix(path, "~/") {
		path = path[2:] // Remove ~/
		segments := strings.Split(path, string(filepath.Separator))
		
		if len(segments) <= 2 {
			return "~/" + path
		}

		// Show ~/...{last-2-segments}
		lastTwo := strings.Join(segments[len(segments)-2:], string(filepath.Separator))
		return "~/..." + string(filepath.Separator) + lastTwo
	}

	// For absolute paths, show /...{last-2-segments}
	segments := strings.Split(path, string(filepath.Separator))
	if len(segments) <= 3 {
		return path
	}

	lastTwo := strings.Join(segments[len(segments)-2:], string(filepath.Separator))
	return string(filepath.Separator) + "..." + string(filepath.Separator) + lastTwo
}