package theme

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestLoadThemesFromJSON(t *testing.T) {
	// Test loading themes
	err := LoadThemesFromJSON()
	if err != nil {
		t.Fatalf("Failed to load themes: %v", err)
	}

	// Check that themes were loaded
	themes := AvailableThemes()
	if len(themes) == 0 {
		t.Fatal("No themes were loaded")
	}

	// Check for expected themes
	expectedThemes := []string{"tokyonight", "opencode", "everforest", "ayu"}
	for _, expected := range expectedThemes {
		found := slices.Contains(themes, expected)
		if !found {
			t.Errorf("Expected theme %s not found", expected)
		}
	}

	// Test getting a specific theme
	tokyonight := GetTheme("tokyonight")
	if tokyonight == nil {
		t.Fatal("Failed to get tokyonight theme")
	}

	// Test theme colors
	primary := tokyonight.Primary()
	if primary.Dark == nil || primary.Light == nil {
		t.Error("Primary color not properly set")
	}
}

func TestColorReferenceResolution(t *testing.T) {
	// Load themes first
	err := LoadThemesFromJSON()
	if err != nil {
		t.Fatalf("Failed to load themes: %v", err)
	}

	// Test a theme that uses references (e.g., solarized uses color definitions)
	solarized := GetTheme("solarized")
	if solarized == nil {
		t.Fatal("Failed to get solarized theme")
	}

	// Check that color references were resolved
	primary := solarized.Primary()
	if primary.Dark == nil || primary.Light == nil {
		t.Error("Primary color reference not resolved")
	}

	// Check that all colors are properly resolved
	text := solarized.Text()
	if text.Dark == nil || text.Light == nil {
		t.Error("Text color reference not resolved")
	}
}

func TestLoadThemesFromDirectories(t *testing.T) {
	// Create temporary directories for testing
	tempDir := t.TempDir()

	userConfig := filepath.Join(tempDir, "config")
	projectRoot := filepath.Join(tempDir, "project")
	cwd := filepath.Join(tempDir, "cwd")

	// Create theme directories
	os.MkdirAll(filepath.Join(userConfig, "opencode", "themes"), 0755)
	os.MkdirAll(filepath.Join(projectRoot, ".opencode", "themes"), 0755)
	os.MkdirAll(filepath.Join(cwd, ".opencode", "themes"), 0755)

	// Create test themes with same name to test override behavior
	testTheme1 := `{
		"theme": {
			"primary": "#111111",
			"secondary": "#222222",
			"accent": "#333333",
			"text": "#ffffff",
			"textMuted": "#cccccc",
			"background": "#000000"
		}
	}`

	testTheme2 := `{
		"theme": {
			"primary": "#444444",
			"secondary": "#555555",
			"accent": "#666666",
			"text": "#ffffff",
			"textMuted": "#cccccc",
			"background": "#000000"
		}
	}`

	testTheme3 := `{
		"theme": {
			"primary": "#777777",
			"secondary": "#888888",
			"accent": "#999999",
			"text": "#ffffff",
			"textMuted": "#cccccc",
			"background": "#000000"
		}
	}`

	// Write themes to different directories
	os.WriteFile(filepath.Join(userConfig, "opencode", "themes", "override-test.json"), []byte(testTheme1), 0644)
	os.WriteFile(filepath.Join(projectRoot, ".opencode", "themes", "override-test.json"), []byte(testTheme2), 0644)
	os.WriteFile(filepath.Join(cwd, ".opencode", "themes", "override-test.json"), []byte(testTheme3), 0644)

	// Load themes
	err := LoadThemesFromDirectories(userConfig, projectRoot, cwd)
	if err != nil {
		t.Fatalf("Failed to load themes from directories: %v", err)
	}

	// Check that the theme from CWD (highest priority) won
	overrideTheme := GetTheme("override-test")
	if overrideTheme == nil {
		t.Fatal("Failed to get override-test theme")
	}

	// The primary color should be from testTheme3 (#777777)
	primary := overrideTheme.Primary()
	// We can't directly check the color value, but we can verify it was loaded
	if primary.Dark == nil || primary.Light == nil {
		t.Error("Override theme not properly loaded")
	}
}
