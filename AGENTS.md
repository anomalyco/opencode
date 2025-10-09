# AGENTS.md

## Development Commands

### Build & Development

- `bun dev` - Start development server for opencode package
- `bun run build` - Build the entire project
- `bun run build:dev` - Build for development
- `bun run test` - Run all tests
- `bun run typecheck` - Type checking
- `bun run lint` - Lint code
- `bun run format` - Check formatting
- `bun run format:fix` - Fix formatting issues

### Testing

- `bun test` - Run all tests
- `npx vitest run tests/file-name.test.ts` - Run specific test file

## Project Structure

This is a monorepo with the following structure:

### Core Packages

- `packages/opencode/` - Main opencode CLI tool
- `packages/console/` - Web console interface
- `packages/core/` - Core functionality
- `packages/function/` - Serverless functions
- `packages/mail/` - Email templates and functionality
- `packages/resource/` - Shared resources
- `packages/scripts/` - Build and utility scripts

### SDKs

- `packages/sdk/go/` - Go SDK
- `packages/sdk/js/` - JavaScript SDK

### Applications

- `packages/desktop/` - Desktop application (Tauri-based)
- `packages/web/` - Web application (Astro-based)
- `packages/tui/` - Terminal user interface (Go-based)

### Extensions

- `packages/plugin/` - Plugin system
- `packages/vscode/` - VS Code extension

## Code Style Guidelines

### Core Principles

- **Single Function**: Keep things in one function unless composable or reusable
- **No Destructuring**: Avoid unnecessary destructuring of variables
- **No Else**: Avoid `else` statements unless absolutely necessary
- **No Try/Catch**: Avoid `try`/`catch` where possible
- **No Any**: Avoid using `any` type
- **No Let**: Prefer `const` over `let`
- **Single Words**: Prefer single word variable names where possible
- **Bun APIs**: Use as many bun apis as possible like Bun.file()

### TypeScript Standards

- **Strict typing**: Use explicit function return types
- **Organized imports**: Group by type (external, internal, relative)
- **Naming conventions**: PascalCase for types/components, camelCase for variables/functions
- **Error handling**: Explicit error types, avoid `any` suppression

## Development Guidelines

### When Adding New Features

1. Use existing patterns and conventions
2. Follow the established file structure
3. Add appropriate tests
4. Run linting and type checking
5. Update documentation if needed

### File Organization

- Keep related files together
- Use index.ts for exports when appropriate
- Follow existing directory naming conventions
- Use descriptive file names that indicate purpose

### Testing

- Use vitest for testing
- Mock external dependencies with vi.mock/vi.spyOn
- Test both success and error cases
- Keep tests focused and isolated

## Environment Setup

1. Install dependencies: `bun install`
2. Copy environment variables if needed
3. Run development server: `bun dev`
4. Run tests: `bun test`

## Common Tasks

### Adding a New Package

1. Create directory in appropriate location
2. Add package.json with proper dependencies
3. Add to workspace configuration
4. Follow existing patterns for structure

### Adding a New Component

1. Check existing components for patterns
2. Use TypeScript with proper typing
3. Add to appropriate index file for exports
4. Add tests if component has business logic

### Debugging

- Use console.log with component prefixes for debugging
- Check browser console for errors
- Use development mode for better error messages
- Run tests to verify functionality

## Tool Calling Best Practices

### Parallel Tool Usage

Always use parallel tools when applicable. Example:

```json
{
  "recipient_name": "multi_tool_use.parallel",
  "parameters": {
    "tool_uses": [
      {
        "recipient_name": "functions.read",
        "parameters": {
          "filePath": "path/to/file.tsx"
        }
      },
      {
        "recipient_name": "functions.read",
        "parameters": {
          "filePath": "path/to/file.ts"
        }
      },
      {
        "recipient_name": "functions.read",
        "parameters": {
          "filePath": "path/to/file.md"
        }
      }
    ]
  }
}
```

## Build System

The project uses:

- **Bun** as package manager and runtime
- **Turbo** for monorepo builds
- **Vite** for bundling
- **TypeScript** for type checking
- **ESLint** for linting
- **Prettier** for formatting

## Deployment

- GitHub Actions for CI/CD
- Automatic deployment on merge to main
- Staging deployments for feature branches
- Build artifacts are generated in dist/ directories
