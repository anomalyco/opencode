package util

import (
	"os"
	"testing"
)

func TestShortenPath(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		maxLength int
		expected  string
	}{
		{
			name:      "short path unchanged",
			path:      "~/project",
			maxLength: 30,
			expected:  "~/project",
		},
		{
			name:      "home path with multiple segments",
			path:      "~/Dev-Space/src-apps/opencode/packages/tui",
			maxLength: 30,
			expected:  "~/.../packages/tui",
		},
		{
			name:      "absolute path shortening",
			path:      "/Users/andy/Dev-Space/src-apps/opencode/packages/tui",
			maxLength: 30,
			expected:  "/.../packages/tui",
		},
		{
			name:      "short absolute path unchanged",
			path:      "/usr/local",
			maxLength: 30,
			expected:  "/usr/local",
		},
		{
			name:      "single segment home path",
			path:      "~/project",
			maxLength: 5,
			expected:  "~/project",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ShortenPath(tt.path, tt.maxLength)
			if result != tt.expected {
				t.Errorf("ShortenPath(%q, %d) = %q, want %q", tt.path, tt.maxLength, result, tt.expected)
			}
		})
	}
}

func TestIsGitRepository(t *testing.T) {
	// Create a temporary directory
	tmpDir, err := os.MkdirTemp("", "git-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Change to temp directory
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	err = os.Chdir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to change to temp dir: %v", err)
	}

	// Test non-git directory
	if IsGitRepository() {
		t.Error("Expected false for non-git directory")
	}

	// Note: We can't easily test a real git repository in unit tests
	// without requiring git to be installed and initialized
	// This would be better tested in integration tests
}

func TestGetGitInfo(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "git-info-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Change to temp directory
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	err = os.Chdir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to change to temp dir: %v", err)
	}

	// Test non-git directory
	info := GetGitInfo()
	if info.IsRepo {
		t.Error("Expected IsRepo to be false for non-git directory")
	}
	if info.Branch != "" {
		t.Error("Expected empty branch for non-git directory")
	}
	if info.CommitHash != "" {
		t.Error("Expected empty commit hash for non-git directory")
	}
}

func TestGetCurrentBranch_NonGitDirectory(t *testing.T) {
	// Create a temporary directory
	tmpDir, err := os.MkdirTemp("", "non-git-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Change to temp directory
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	err = os.Chdir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to change to temp dir: %v", err)
	}

	// Test should return error for non-git directory
	_, err = GetCurrentBranch()
	if err == nil {
		t.Error("Expected error for non-git directory")
	}
}

func TestGetShortCommitHash_NonGitDirectory(t *testing.T) {
	// Create a temporary directory
	tmpDir, err := os.MkdirTemp("", "non-git-hash-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Change to temp directory
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	err = os.Chdir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to change to temp dir: %v", err)
	}

	// Test should return error for non-git directory
	_, err = GetShortCommitHash()
	if err == nil {
		t.Error("Expected error for non-git directory")
	}
}

// Benchmark tests
func BenchmarkShortenPath(b *testing.B) {
	path := "~/Dev-Space/src-apps/opencode/packages/tui/internal/components/status"
	for i := 0; i < b.N; i++ {
		ShortenPath(path, 30)
	}
}

func BenchmarkGetGitInfo(b *testing.B) {
	for i := 0; i < b.N; i++ {
		GetGitInfo()
	}
}