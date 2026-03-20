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

#### Conflict-Aware Parallel Scheduler

OpenCode includes a built-in scheduler that analyzes subtask file scopes to prevent merge conflicts. When subtasks have overlapping file scopes, they are automatically scheduled into serial waves instead of running in parallel.

**Scheduler Modes:**

| Mode     | Behavior                                                               |
| -------- | ---------------------------------------------------------------------- |
| `auto`   | Automatically creates execution waves, warns about file scope overlaps |
| `strict` | Fails plan approval if any file scope overlaps exist without override  |
| `off`    | Disables wave scheduling - all subtasks run in parallel (default)      |

**How Wave Scheduling Works:**

- **Parallel waves**: Subtasks with disjoint file scopes run concurrently
- **Serial waves**: Subtasks with overlapping file scopes run sequentially
- Waves are computed deterministically based on dependency order and file overlaps

**Configuration:**

```bash
# Enable auto mode with wave scheduling
opencode config set parallel.scheduler_mode auto

# Use strict mode for overlap-free guarantees
opencode config set parallel.scheduler_mode strict

# Disable scheduling (default behavior)
opencode config set parallel.scheduler_mode off
```

**Config file example:**

```json
{
  "parallel": {
    "scheduler_mode": "auto",
    "publish_mode": "new-branch"
  }
}
```

#### Parallel Plan Linter + Auto-Rewrite

OpenCode includes a plan linter that analyzes subtask file scopes before execution and optionally auto-rewrites risky plans into safer layouts. This prevents merge-conflict cascades by isolating shared registry/wiring files into a dedicated final subtask.

**Lint Modes:**

| Mode     | Behavior                                                                |
| -------- | ----------------------------------------------------------------------- |
| `off`    | Disable linting (default)                                               |
| `warn`   | Show diagnostics in plan review, no rewrite                             |
| `auto`   | Automatically rewrite plans to isolate shared files into wiring subtask |
| `strict` | Fail plan approval if any overlap, duplicate, or hotspot detected       |

**What the Linter Detects:**

- **File scope overlaps**: Subtasks claiming overlapping paths (parent/child directories)
- **Duplicate file ownership**: Multiple subtasks claiming the same exact file
- **Hotspot files**: Shared registry files (`src/cli/registry.ts`), orchestrator wiring (`src/parallel/orchestrator.ts`), CLI indices

**Auto-Rewrite Behavior:**

In `auto` mode, plans with lint errors are automatically rewritten:

1. Shared/hotspot files are removed from original subtasks
2. A new final "wiring" subtask is created with all shared files
3. The wiring subtask depends on all subtasks that touched shared files
4. The wiring subtask runs serially after all parallel work completes

**Example - Before Rewrite:**

```json
{
  "subtasks": [
    { "id": "1", "title": "Add feature A", "fileScope": ["src/feature-a.ts", "src/cli/registry.ts"] },
    { "id": "2", "title": "Add feature B", "fileScope": ["src/feature-b.ts", "src/cli/registry.ts"] }
  ]
}
```

**Example - After Auto-Rewrite:**

```json
{
  "subtasks": [
    { "id": "1", "title": "Add feature A", "fileScope": ["src/feature-a.ts"] },
    { "id": "2", "title": "Add feature B", "fileScope": ["src/feature-b.ts"] },
    {
      "id": "wiring-123",
      "title": "Final wiring (shared files)",
      "fileScope": ["src/cli/registry.ts"],
      "dependencies": ["1", "2"]
    }
  ]
}
```

**Configuration:**

```bash
# Enable auto-rewrite mode
opencode config set parallel.lint_mode auto

# Use strict mode for guaranteed clean plans
opencode config set parallel.lint_mode strict

# Show warnings only
opencode config set parallel.lint_mode warn
```

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
