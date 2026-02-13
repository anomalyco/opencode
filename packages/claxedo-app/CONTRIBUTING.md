# Contributing to Claxedo App

Thank you for your interest in contributing to Claxedo! This document provides guidelines for contributing to the project.

## Overview

Claxedo is a cloud-enabled wrapper/extension of [OpenCode](https://github.com/anomalyco/opencode). It adds cloud features, authentication, remote access, and a custom UI while maintaining compatibility with upstream OpenCode updates.

The key architectural principle is that **upstream packages remain pristine** - all Claxedo customizations live in the override system, allowing for seamless daily upstream syncs.

## When to Contribute Upstream vs. Claxedo

### Contribute to Upstream OpenCode

- Core functionality and bug fixes
- Shared UI components that benefit all users
- Performance improvements to base systems
- Generic extension points that enable customization
- Documentation improvements for base features

### Contribute to Claxedo

- Cloud-specific features (workspace management, cloud storage)
- Authentication and authorization (Clerk integration)
- Custom UI layouts (rail sidebar, tab navigation)
- Desktop-specific features (Tauri plugins, deep linking)
- Remote access and tunneling
- Server-scoped state management
- Multi-workspace orchestration

## Architecture Reference

See [ARCHITECTURE.md](./ARCHITECTURE.md) for comprehensive documentation on:
- Override system mechanics
- Context provider architecture
- Extension system
- Feature flags
- Cloud components
- Desktop integration

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- Node.js 20+ (for compatibility)
- [Rust](https://rustup.rs/) toolchain (for desktop builds)
- [Tauri CLI](https://tauri.app/) (for desktop development)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd opencode
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment**
   ```bash
   cp packages/claxedo-app/.env.example packages/claxedo-app/.env.local
   # Edit .env.local with your configuration
   ```

4. **Start development server**
   ```bash
   cd packages/claxedo-app
   bun run dev
   ```

5. **For desktop development**
   ```bash
   cd packages/claxedo-app
   bun run desktop:dev
   ```

## Override System

The override system allows Claxedo to customize upstream files without modifying them directly.

### How It Works

1. Files in `src/overrides/` are aliased to replace upstream `@/` imports
2. Vite resolves `@/context/terminal` to `src/overrides/context/terminal.tsx` if present
3. Otherwise, it falls back to `packages/app/src/context/terminal.tsx`

### Adding a New Override

1. **Copy the upstream file**
   ```bash
   cp ../app/src/components/new-component.tsx src/overrides/components/
   ```

2. **Make your changes** in the override file

3. **Keep imports using `@/`** - they resolve through the same system

4. **Document the override** in ARCHITECTURE.md with:
   - What file is overridden
   - Why it needs to be overridden
   - What changes were made

### Override Best Practices

- Keep overrides minimal - only change what's necessary
- Document the reason for each override
- Check upstream changes during daily sync
- Consider upstreaming changes when they benefit everyone

## Testing Guidelines

### Running Tests

```bash
# Type checking
bun run typecheck

# Build verification
bun run build
```

### Testing Checklist

- [ ] Web build works (`bun run build`)
- [ ] Desktop build works (`bun run desktop:build`)
- [ ] Override files resolve correctly
- [ ] Cloud features work in development
- [ ] Authentication flow works
- [ ] Workspace creation/management works
- [ ] Terminal functionality works

## Pull Request Guidelines

### Before Submitting

1. **Ensure upstream is pristine**
   ```bash
   git diff upstream/dev -- packages/app packages/ui packages/desktop
   # Should show NO changes
   ```

2. **Verify builds work**
   ```bash
   bun run build
   bun run desktop:build
   ```

3. **Update documentation**
   - Add changelog entry for user-facing changes
   - Update ARCHITECTURE.md for structural changes
   - Document new overrides

### PR Format

```markdown
## Summary
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Changes
- List of specific changes

## Testing
- How changes were tested

## Screenshots (if applicable)
```

### Commit Messages

Follow conventional commit format:
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(cloud): add workspace sharing functionality
fix(terminal): resolve PTY cleanup on workspace switch
docs(architecture): document override system
```

## Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and small

## Questions?

- Check existing issues and discussions
- Review the architecture documentation
- Ask in the project's communication channels
