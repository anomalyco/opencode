package completions

// CompletionProvider defines the interface for completion data providers
type CompletionProvider interface {
	GetId() string
	GetChildEntries(query string) ([]CompletionSuggestion, error)
	GetEmptyMessage() string
}
