# TUI Agent Guidelines

## Build/Test Commands

- **Build**: `go build ./cmd/opencode` (builds main binary)
- **Test**: `go test ./...` (runs all tests)
- **Single test**: `go test ./internal/theme -run TestLoadThemesFromJSON` (specific test)
- **Release build**: Uses `.goreleaser.yml` configuration

## Code Style

- **Language**: Go 1.24+ with standard formatting (`gofmt`)
- **Imports**: Group standard, third-party, local packages with blank lines
- **Naming**: Go conventions - PascalCase exports, camelCase private, ALL_CAPS constants
- **Error handling**: Return errors explicitly, use `fmt.Errorf` for wrapping
- **Structs**: Define clear interfaces, embed when appropriate
- **Testing**: Use table-driven tests, `t.TempDir()` for file operations

## Architecture

- **TUI Framework**: Bubble Tea v2 with Lipgloss v2 for styling
- **Client**: Generated OpenAPI client communicates with TypeScript server
- **Components**: Reusable UI components in `internal/components/`
- **Themes**: JSON-based theming system with override hierarchy
- **State**: Centralized app state with message passing
