package theme

import (
	"fmt"
	"image/color"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/alecthomas/chroma/v2/styles"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/charmbracelet/x/ansi"
)

// Manager handles theme registration, selection, and retrieval.
// It maintains a registry of available themes and tracks the currently active theme.
type Manager struct {
	themes               map[string]Theme
	currentName          string
	currentUsesAnsiCache bool // Cache whether current theme uses ANSI colors
	mu                   sync.RWMutex
}

// Global instance of the theme manager
var globalManager = &Manager{
	themes:      make(map[string]Theme),
	currentName: "",
}

// RegisterTheme adds a new theme to the registry.
// If this is the first theme registered, it becomes the default.
func RegisterTheme(name string, theme Theme) {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()

	globalManager.themes[name] = theme

	// If this is the first theme, make it the default
	if globalManager.currentName == "" {
		globalManager.currentName = name
		globalManager.currentUsesAnsiCache = themeUsesAnsiColors(theme)
	}
}

// SetTheme changes the active theme to the one with the specified name.
// Returns an error if the theme doesn't exist.
func SetTheme(name string) error {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()
	delete(styles.Registry, "charm")

	theme, exists := globalManager.themes[name]
	if !exists {
		return fmt.Errorf("theme '%s' not found", name)
	}

	globalManager.currentName = name
	globalManager.currentUsesAnsiCache = themeUsesAnsiColors(theme)

	return nil
}

// CurrentTheme returns the currently active theme.
// If no theme is set, it returns nil.
func CurrentTheme() Theme {
	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	if globalManager.currentName == "" {
		return nil
	}

	return globalManager.themes[globalManager.currentName]
}

// CurrentThemeName returns the name of the currently active theme.
func CurrentThemeName() string {
	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	return globalManager.currentName
}

// AvailableThemes returns a list of all registered theme names.
func AvailableThemes() []string {
	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	names := make([]string, 0, len(globalManager.themes))
	for name := range globalManager.themes {
		names = append(names, name)
	}
	slices.SortFunc(names, func(a, b string) int {
		if a == "opencode" {
			return -1
		} else if b == "opencode" {
			return 1
		}
		if a == "system" {
			return -1
		} else if b == "system" {
			return 1
		}
		return strings.Compare(a, b)
	})
	return names
}

// GetTheme returns a specific theme by name.
// Returns nil if the theme doesn't exist.
func GetTheme(name string) Theme {
	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	return globalManager.themes[name]
}

// UpdateSystemTheme updates the system theme with terminal background info
func UpdateSystemTheme(terminalBg color.Color, isDark bool) {
	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()

	dynamicTheme := NewSystemTheme(terminalBg, isDark)
	globalManager.themes["system"] = dynamicTheme
	if globalManager.currentName == "system" {
		globalManager.currentUsesAnsiCache = themeUsesAnsiColors(dynamicTheme)
	}
}

// CurrentThemeUsesAnsiColors returns true if the current theme uses ANSI 0-16 colors
func CurrentThemeUsesAnsiColors() bool {
	// globalManager.mu.RLock()
	// defer globalManager.mu.RUnlock()

	return globalManager.currentUsesAnsiCache
}

// isAnsiColor checks if a color represents an ANSI 0-16 color
func isAnsiColor(c color.Color) bool {
	if _, ok := c.(lipgloss.NoColor); ok {
		return false
	}
	if _, ok := c.(ansi.BasicColor); ok {
		return true
	}

	// For other color types, check if they represent ANSI colors
	// by examining their string representation
	if stringer, ok := c.(fmt.Stringer); ok {
		str := stringer.String()
		// Check if it's a numeric ANSI color (0-15)
		if num, err := strconv.Atoi(str); err == nil && num >= 0 && num <= 15 {
			return true
		}
	}

	return false
}

// adaptiveColorUsesAnsi checks if an AdaptiveColor uses ANSI colors
func adaptiveColorUsesAnsi(ac compat.AdaptiveColor) bool {
	if isAnsiColor(ac.Dark) {
		return true
	}
	if isAnsiColor(ac.Light) {
		return true
	}
	return false
}

// themeUsesAnsiColors checks if a theme uses any ANSI 0-16 colors
func themeUsesAnsiColors(theme Theme) bool {
	if theme == nil {
		return false
	}

	return adaptiveColorUsesAnsi(theme.Primary()) ||
		adaptiveColorUsesAnsi(theme.Secondary()) ||
		adaptiveColorUsesAnsi(theme.Accent()) ||
		adaptiveColorUsesAnsi(theme.Error()) ||
		adaptiveColorUsesAnsi(theme.Warning()) ||
		adaptiveColorUsesAnsi(theme.Success()) ||
		adaptiveColorUsesAnsi(theme.Info()) ||
		adaptiveColorUsesAnsi(theme.Text()) ||
		adaptiveColorUsesAnsi(theme.TextMuted()) ||
		adaptiveColorUsesAnsi(theme.Background()) ||
		adaptiveColorUsesAnsi(theme.BackgroundPanel()) ||
		adaptiveColorUsesAnsi(theme.BackgroundElement()) ||
		adaptiveColorUsesAnsi(theme.Border()) ||
		adaptiveColorUsesAnsi(theme.BorderActive()) ||
		adaptiveColorUsesAnsi(theme.BorderSubtle()) ||
		adaptiveColorUsesAnsi(theme.DiffAdded()) ||
		adaptiveColorUsesAnsi(theme.DiffRemoved()) ||
		adaptiveColorUsesAnsi(theme.DiffContext()) ||
		adaptiveColorUsesAnsi(theme.DiffHunkHeader()) ||
		adaptiveColorUsesAnsi(theme.DiffHighlightAdded()) ||
		adaptiveColorUsesAnsi(theme.DiffHighlightRemoved()) ||
		adaptiveColorUsesAnsi(theme.DiffAddedBg()) ||
		adaptiveColorUsesAnsi(theme.DiffRemovedBg()) ||
		adaptiveColorUsesAnsi(theme.DiffContextBg()) ||
		adaptiveColorUsesAnsi(theme.DiffLineNumber()) ||
		adaptiveColorUsesAnsi(theme.DiffAddedLineNumberBg()) ||
		adaptiveColorUsesAnsi(theme.DiffRemovedLineNumberBg()) ||
		adaptiveColorUsesAnsi(theme.MarkdownText()) ||
		adaptiveColorUsesAnsi(theme.MarkdownHeading()) ||
		adaptiveColorUsesAnsi(theme.MarkdownLink()) ||
		adaptiveColorUsesAnsi(theme.MarkdownLinkText()) ||
		adaptiveColorUsesAnsi(theme.MarkdownCode()) ||
		adaptiveColorUsesAnsi(theme.MarkdownBlockQuote()) ||
		adaptiveColorUsesAnsi(theme.MarkdownEmph()) ||
		adaptiveColorUsesAnsi(theme.MarkdownStrong()) ||
		adaptiveColorUsesAnsi(theme.MarkdownHorizontalRule()) ||
		adaptiveColorUsesAnsi(theme.MarkdownListItem()) ||
		adaptiveColorUsesAnsi(theme.MarkdownListEnumeration()) ||
		adaptiveColorUsesAnsi(theme.MarkdownImage()) ||
		adaptiveColorUsesAnsi(theme.MarkdownImageText()) ||
		adaptiveColorUsesAnsi(theme.MarkdownCodeBlock()) ||
		adaptiveColorUsesAnsi(theme.SyntaxComment()) ||
		adaptiveColorUsesAnsi(theme.SyntaxKeyword()) ||
		adaptiveColorUsesAnsi(theme.SyntaxFunction()) ||
		adaptiveColorUsesAnsi(theme.SyntaxVariable()) ||
		adaptiveColorUsesAnsi(theme.SyntaxString()) ||
		adaptiveColorUsesAnsi(theme.SyntaxNumber()) ||
		adaptiveColorUsesAnsi(theme.SyntaxType()) ||
		adaptiveColorUsesAnsi(theme.SyntaxOperator()) ||
		adaptiveColorUsesAnsi(theme.SyntaxPunctuation())
}
