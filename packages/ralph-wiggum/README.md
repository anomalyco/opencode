# Ralph Wiggum Plugin for OpenCode

Implements the Ralph Wiggum technique for iterative, self-referential AI development loops.

Based on: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum

## Usage

```bash
ralph-loop "Your task here" --max 8 --promise "DONE"
ralph-loop "Your task here" --max 8 --promise "DONE" --state-file /custom/path.json
ralph-loop "Your task here" --no-state  # Disable state file
```

## How It Works

The loop will:

1. Execute the prompt
2. Continue iterating until max iterations OR completion promise is found
3. Feed the SAME original prompt back each iteration
4. Show iteration count in system message
5. Write state to `~/.config/opencode/state/ralph-wiggum.json` (or custom path) for verification

## Review System

The plugin includes a review system with three phases:

- **working**: Initial phase where the task is executed
- **review**: After completion, changes are reviewed for quality
- **fix**: If issues are found, fixes are applied before re-review

## State File

The state file includes:

- `sessionID`: Current session identifier
- `active`: Whether the loop is running
- `prompt`: The original prompt
- `iterations`: Current iteration count
- `max`: Maximum iterations allowed
- `status`: Current status (`running`, `completed`, `cancelled`, `max_reached`, `approved`, `max_reviews_reached`)
- `phase`: Current phase (`working`, `review`, `fix`)
- `reviewCount`: Number of review cycles
- `maxReviews`: Maximum review cycles allowed (default: 5)

## Environment Variables

### OPENCODE_SKIP_LOCAL_RALPH

Set this environment variable to skip loading the local plugin version. This is useful when:

- You have the plugin symlinked locally for development
- But want to use a global plugin version on certain machines

```bash
# Add to ~/.zshrc or ~/.bashrc
export OPENCODE_SKIP_LOCAL_RALPH=1
```

When set, the local plugin will be skipped, allowing the global plugin to take precedence.

## Development

When developing this plugin locally, you can symlink it into your project's `.opencode/plugins/` directory:

```bash
ln -s ../../../../ralph-wiggum/src/index.ts .opencode/plugins/ralph-wiggum.ts
```

This allows changes to the plugin source to be immediately available without copying files.
