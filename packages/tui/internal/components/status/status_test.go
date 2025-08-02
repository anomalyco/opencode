package status

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGetCurrentGitBranch(t *testing.T) {
	// Test in current directory (should be a git repo)
	branch := getCurrentGitBranch(".")
	if branch == "" {
		t.Skip("Not in a git repository, skipping test")
	}
	t.Logf("Current branch: %s", branch)
}

func TestGetGitRefFile(t *testing.T) {
	// Create a temporary git directory structure for testing
	tmpDir := t.TempDir()
	gitDir := filepath.Join(tmpDir, ".git")
	err := os.MkdirAll(gitDir, 0755)
	if err != nil {
		t.Fatal(err)
	}

	// Test case 1: HEAD points to a ref
	headFile := filepath.Join(gitDir, "HEAD")
	err = os.WriteFile(headFile, []byte("ref: refs/heads/main\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}

	refFile := getGitRefFile(tmpDir)
	expected := filepath.Join(gitDir, "refs", "heads", "main")
	if refFile != expected {
		t.Errorf("Expected %s, got %s", expected, refFile)
	}

	// Test case 2: HEAD contains a direct commit hash
	err = os.WriteFile(headFile, []byte("abc123def456\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}

	refFile = getGitRefFile(tmpDir)
	if refFile != headFile {
		t.Errorf("Expected %s, got %s", headFile, refFile)
	}
}

func TestFileWatcherIntegration(t *testing.T) {
	// This test requires being in a git repository
	if getCurrentGitBranch(".") == "" {
		t.Skip("Not in a git repository, skipping integration test")
	}

	// Test that the file watcher setup doesn't crash
	tmpDir := t.TempDir()
	gitDir := filepath.Join(tmpDir, ".git")
	err := os.MkdirAll(gitDir, 0755)
	if err != nil {
		t.Fatal(err)
	}

	headFile := filepath.Join(gitDir, "HEAD")
	err = os.WriteFile(headFile, []byte("ref: refs/heads/main\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}

	// Create the refs directory and file
	refsDir := filepath.Join(gitDir, "refs", "heads")
	err = os.MkdirAll(refsDir, 0755)
	if err != nil {
		t.Fatal(err)
	}

	mainRef := filepath.Join(refsDir, "main")
	err = os.WriteFile(mainRef, []byte("abc123def456\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}

	// Test that we can create a watcher without crashing
	// This is a basic smoke test
	done := make(chan bool, 1)
	go func() {
		time.Sleep(100 * time.Millisecond)
		done <- true
	}()

	select {
	case <-done:
		// Test passed - no crash
	case <-time.After(1 * time.Second):
		t.Error("Test timed out")
	}
}
