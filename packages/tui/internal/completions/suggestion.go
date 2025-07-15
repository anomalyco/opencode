package completions

import "github.com/sst/opencode/internal/styles"

// CompletionSuggestion represents a data-only completion suggestion
// with no styling or rendering logic
type CompletionSuggestion struct {
	// The text to be displayed in the list. May contain minimal inline
	// ANSI styling if intrinsic to the data (e.g., git diff colors).
	Display func(styles.Style) string

	// The value to be used when the item is selected (e.g., inserted into the editor).
	Value string

	// An optional, longer description to be displayed.
	Description string

	// The ID of the provider that generated this suggestion.
	ProviderID string

	// The raw, underlying data object (e.g., opencode.Symbol, commands.Command).
	// This allows the selection handler to perform rich actions.
	RawData any
}
