# OpenCode

OpenCode is a fast, AI-powered coding assistant that helps you write, refactor, and understand code.

## Installation

```bash
bun install
```

## CLI Commands

### Basic Commands

- `opencode version-json` - Outputs the current version as JSON

### Parallel Execution

OpenCode supports parallel task execution across multiple git worktrees, enabling concurrent development workflows with automatic integration.

#### Publish Modes

When parallel execution completes, you can choose how to publish changes with three modes:

| Mode         | Description                                          | Use Case                                |
| ------------ | ---------------------------------------------------- | --------------------------------------- |
| `new-branch` | Creates a new branch for each subtask and opens a PR | Collaborative review, CI/CD integration |
| `unstaged`   | Leaves changes as unstaged files in current worktree | Manual review before committing         |
| `direct`     | Commits changes directly to the current branch       | Quick fixes, trusted automation         |

#### Configuration

Configure publish mode in your `AGENTS.md` or via CLI:

```bash
# Set default publish mode
opencode config set parallel.publish_mode new-branch

# Per-command override
opencode parallel --publish-mode=direct
```

**Config file example (`AGENTS.md`):**

```markdown
## Parallel Execution

- Default publish mode: `new-branch`
- Integration branch naming: `parallel-{plan_id}`
- Auto-merge on success: false
```

#### Integration Branch Naming

When using `new-branch` mode, integration branches follow this pattern:

```
parallel-{plan_id}-{timestamp}
```

Examples:

- `parallel-abc123-20240320123456`
- `parallel-fix-login-20240320150000`

#### Migration from Staged Mode

The `staged` mode has been deprecated in favor of `unstaged`. To migrate:

1. Update your config:

   ```bash
   # Before (deprecated)
   opencode config set parallel.publish_mode staged

   # After
   opencode config set parallel.publish_mode unstaged
   ```

2. Update `AGENTS.md` references from `staged` to `unstaged`

3. The behavior is equivalent - changes remain unstaged for manual review

#### Usage Examples

**Create a parallel plan with new-branch publishing:**

```bash
opencode parallel plan --publish-mode=new-branch --subtasks \
  "Fix authentication bug" \
  "Update documentation" \
  "Add unit tests"
```

**Execute with unstaged changes for review:**

```bash
opencode parallel execute --publish-mode=unstaged --plan-id=abc123
```

**Quick direct commit for trusted changes:**

```bash
opencode parallel execute --publish-mode=direct --plan-id=abc123 --message="Automated fixes"
```

**Resume an interrupted parallel execution:**

```bash
opencode parallel resume --plan-id=abc123
```

**Check parallel execution status:**

```bash
opencode parallel status --plan-id=abc123
```

## Development

This project was created using `bun init` in bun v1.2.12. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

To run locally:

```bash
bun run index.ts
```
