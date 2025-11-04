# Parallel Mode

OpenCode supports parallel mode, enabling multiple concurrent sessions to work on isolated git worktrees. This prevents conflicts and enables true parallel development workflows.

## Features

- **Isolated Worktrees**: Each parallel session works in a separate git worktree
- **Auto Branch Creation**: Automatically creates branches from your prompt
- **Auto Commit**: Commits all changes after session completion
- **Clean Merge**: Provides clear instructions for merging changes back
- **Automatic Cleanup**: Removes worktrees after completion

## Usage

### Basic Parallel Mode

Run OpenCode with the `--parallel` flag to create an isolated worktree:

```bash
opencode run --parallel "Add authentication to user service"
```

This will:

1. Create a new branch: `add-authentication-to-user-service-{timestamp}`
2. Create a worktree in `/tmp/opencode-worktree-{branch-name}`
3. Execute your task in the isolated worktree
4. Auto-commit changes with a descriptive message
5. Print merge instructions
6. Clean up the worktree

### Using Existing Branch

Continue work on an existing branch:

```bash
opencode run --parallel --existing-branch feature/auth "Continue auth implementation"
```

### With File Attachments

Attach files to provide context:

```bash
opencode run --parallel -f package.json -f src/auth.ts "Update authentication"
```

### With Custom Model

Use a specific model:

```bash
opencode run --parallel --model anthropic/claude-3-5-sonnet-20241022 "Refactor auth module"
```

## How It Works

### 1. Branch Creation

Branches are automatically named based on your prompt:

- Lowercase conversion
- Special characters replaced with hyphens
- Truncated to 50 characters
- Timestamp appended for uniqueness

Example: `"Add Dark Mode"` → `add-dark-mode-1730745123456`

### 2. Worktree Location

Worktrees are created in the system temp directory:

```
/tmp/opencode-worktree-{branch-name}
```

### 3. Auto Commit

After task completion, all changes are automatically committed:

```
OpenCode parallel mode: {branch-name}

Automatically committed by OpenCode parallel mode
```

### 4. Merge Instructions

After completion, you'll see:

```
📋 Merge Instructions:
  1. Review changes:
     git log main..add-dark-mode-1730745123456
  2. Merge to main branch:
     git checkout main
     git merge add-dark-mode-1730745123456
  3. Delete branch (optional):
     git branch -d add-dark-mode-1730745123456
```

## Requirements

- Must be in a git repository
- Cannot be used with `--continue` or `--session` flags
- Requires a prompt message

## Examples

### Feature Development

```bash
# Develop new feature in isolation
opencode run --parallel "Implement user profile page with avatar upload"
```

### Bug Fixes

```bash
# Fix bug on existing branch
opencode run --parallel --existing-branch hotfix/auth-token "Fix token expiration issue"
```

### Multiple Parallel Sessions

Run multiple sessions simultaneously:

```bash
# Terminal 1
opencode run --parallel "Add dark mode toggle"

# Terminal 2
opencode run --parallel "Implement search functionality"

# Terminal 3
opencode run --parallel "Update documentation"
```

Each session works in isolation without conflicts!

## Troubleshooting

### Worktree Already Exists

If a worktree already exists at the target path:

```bash
git worktree remove /tmp/opencode-worktree-{branch-name}
```

### Branch Already Exists

Use `--existing-branch` to continue work on an existing branch, or choose a different prompt to generate a unique branch name.

### Cleanup Failed

If automatic cleanup fails, manually remove the worktree:

```bash
git worktree remove /tmp/opencode-worktree-{branch-name}
```

## Architecture

Parallel mode consists of three main components:

### Branch Manager (`src/parallel/branch.ts`)

- Branch name generation and sanitization
- Branch validation for existing branches

### Worktree Manager (`src/parallel/worktree.ts`)

- Git worktree creation and removal
- Worktree path management

### Parallel Orchestrator (`src/parallel/index.ts`)

- Coordinates setup and teardown
- Auto-commit functionality
- Merge instructions

## Testing

Run parallel mode tests:

```bash
bun test test/parallel/
```

## Future Enhancements

- AI-generated commit messages
- Configurable worktree location
- Branch cleanup automation
- Merge conflict resolution assistance
- Integration with PR creation workflows
