# Contributing to OpenCode

Thank you for your interest in contributing to OpenCode!

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.1
- [Git](https://git-scm.com/)
- [ripgrep](https://github.com/BurntSushi/ripgrep) (for code search tests)

### Setup

```bash
git clone https://github.com/opencode-ai/opencode.git
cd opencode
bun install
```

### Running Tests

```bash
bun test
```

### Type Checking

```bash
bun run typecheck
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `bun test`
5. Run type check: `bun run typecheck`
6. Commit with conventional commits: `git commit -m "feat: add my feature"`
7. Push to your fork: `git push origin feat/my-feature`
8. Open a Pull Request

## Code Style

- TypeScript with Bun runtime
- Namespace-based module organization
- Zod for runtime validation
- `camelCase` for functions/variables, `PascalCase` for types/namespaces
- kebab-case for file names

## Pull Request Requirements

- [ ] Tests pass (`bun test`)
- [ ] Type check passes (`bun run typecheck`)
- [ ] Conventional commit message format
- [ ] Link to related issue
- [ ] Documentation updated if needed
- [ ] Screenshots for UI changes

## Commit Message Format

```
type(scope): description

feat: new feature
fix: bug fix
docs: documentation only
test: adding tests
refactor: code restructuring
chore: tooling/config
```

## Reporting Bugs

Please use [GitHub Issues](https://github.com/opencode-ai/opencode/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- OpenCode version (`opencode --version`)
- OS and runtime version

## Feature Requests

Open a GitHub Issue with the `feature-request` label.

## Code of Conduct

Be respectful, inclusive, and constructive.
