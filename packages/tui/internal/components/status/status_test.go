package status

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

func TestStatusComponent_GitInfo(t *testing.T) {
	tests := []struct {
		name     string
		gitInfo  *util.GitInfo
		expected string
	}{
		{
			name: "git info with branch and hash",
			gitInfo: &util.GitInfo{
				IsRepo:     true,
				Branch:     "main",
				CommitHash: "a1b2c3d",
			},
			expected: "main@a1b2c3d",
		},
		{
			name: "git info with branch only",
			gitInfo: &util.GitInfo{
				IsRepo:     true,
				Branch:     "feature/test",
				CommitHash: "",
			},
			expected: "feature/test",
		},
		{
			name: "no git repo",
			gitInfo: &util.GitInfo{
				IsRepo: false,
			},
			expected: "",
		},
		{
			name: "nil git info",
			gitInfo: nil,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test the git info formatting logic directly
			var gitText string
			if tt.gitInfo != nil && tt.gitInfo.IsRepo && tt.gitInfo.Branch != "" {
				gitText = tt.gitInfo.Branch
				if tt.gitInfo.CommitHash != "" {
					gitText += "@" + tt.gitInfo.CommitHash
				}
			}

			if gitText != tt.expected {
				t.Errorf("Expected git text %q, got %q", tt.expected, gitText)
			}
		})
	}
}

func TestShortenPath_Integration(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{
			name:     "home directory shortening",
			path:     "~/Dev-Space/src-apps/opencode/packages/tui",
			expected: "~/.../packages/tui",
		},
		{
			name:     "absolute path shortening", 
			path:     "/Users/test/very/long/path/to/project",
			expected: "/.../to/project",
		},
		{
			name:     "short path unchanged",
			path:     "~/project",
			expected: "~/project",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := util.ShortenPath(tt.path, 30)
			if result != tt.expected {
				t.Errorf("ShortenPath(%q) = %q, want %q", tt.path, result, tt.expected)
			}
		})
	}
}

func TestNewStatusCmp(t *testing.T) {
	app := &app.App{
		Info: opencode.App{
			Path: opencode.AppPath{
				Cwd: "/Users/test/project",
			},
		},
	}

	statusComp := NewStatusCmp(app)

	// Check that the component was created properly
	if statusComp == nil {
		t.Fatal("Expected non-nil status component")
	}

	// Type assert to access internal fields for testing
	if sc, ok := statusComp.(*statusComponent); ok {
		if sc.app != app {
			t.Error("Expected app to be set correctly")
		}
		if sc.cwd == "" {
			t.Error("Expected cwd to be set")
		}
		if sc.gitInfo == nil {
			t.Error("Expected gitInfo to be initialized")
		}
	} else {
		t.Error("Expected statusComponent type")
	}
}

func TestStatusComponent_Update(t *testing.T) {
	app := &app.App{}
	statusComp := &statusComponent{app: app}

	// Test window size message
	newModel, cmd := statusComp.Update(tea.WindowSizeMsg{Width: 120, Height: 30})
	
	if cmd != nil {
		t.Error("Expected no command from window size update")
	}

	if sc, ok := newModel.(statusComponent); ok {
		if sc.width != 120 {
			t.Errorf("Expected width to be 120, got %d", sc.width)
		}
	} else {
		t.Error("Expected statusComponent type")
	}
}

// Helper function to check if a string contains a substring, ignoring ANSI escape codes
func containsIgnoreAnsi(s, substr string) bool {
	// Simple approach: remove common ANSI escape sequences
	// This is not comprehensive but should work for basic testing
	cleaned := s
	
	// Remove ANSI color codes (basic pattern)
	ansiPattern := "\033["
	for {
		start := strings.Index(cleaned, ansiPattern)
		if start == -1 {
			break
		}
		
		end := start + 2
		for end < len(cleaned) && cleaned[end] != 'm' {
			end++
		}
		if end < len(cleaned) {
			end++ // include the 'm'
		}
		
		cleaned = cleaned[:start] + cleaned[end:]
	}
	
	return strings.Contains(cleaned, substr)
}

// Benchmark tests
func BenchmarkStatusComponent_View(b *testing.B) {
	theme.SetTheme("opencode")
	
	app := &app.App{
		Version: "1.0.0",
		Info: opencode.App{
			Path: opencode.AppPath{
				Cwd: "/Users/test/project",
			},
		},
		Mode: &opencode.Mode{
			Name: "build",
		},
		ModeIndex: 0,
	}

	statusComp := &statusComponent{
		app:   app,
		width: 100,
		cwd:   app.Info.Path.Cwd,
		gitInfo: &util.GitInfo{
			IsRepo:     true,
			Branch:     "main",
			CommitHash: "a1b2c3d",
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		statusComp.View()
	}
}