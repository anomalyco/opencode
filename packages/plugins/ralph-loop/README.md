# Ralph Loop for OpenCode

A small official plugin that reproduces the Ralph Wiggum technique inside an
OpenCode session: the same prompt is fed back after each turn until the
assistant emits a completion marker or the iteration budget is exhausted.

It is built on the `experimental.idle` Session hook, the same mechanism used by
OpenCode's built-in `/goal`: input admitted from that hook runs in the same
execution instead of letting the Session go idle.

## Install

Plugins are installed from a Git URL. Add the package path to
`opencode.json(c)`:

```jsonc
{
  "plugins": ["./packages/plugins/ralph-loop"],
}
```

## Usage

```text
/ralph-loop "Implement the todo API. Tests must pass." --completion-promise "COMPLETE" --max-iterations 20
```

Options:

| Option                        | Default | Meaning                                           |
| :---------------------------- | ------: | :------------------------------------------------ |
| `--completion-promise <text>` |   empty | exact string the assistant must include to finish |
| `--max-iterations <n>`        |      50 | hard stop; the loop pauses at this count          |

Cancel with:

```text
/cancel-ralph
```

## Behavior

- The task is persisted in plugin storage, keyed by Session.
- The task also becomes a session instruction entry, so compaction does not
  lose it.
- Before each continuation the plugin reads the assistant messages and checks
  the completion marker.
- If the Session has a running shell or subagent, the hook returns; that work
  wakes the Session and the hook runs again.
- A server restart pauses an active loop instead of resuming silently.
- The loop never runs commands by itself: it only injects a synthetic user
  message with the next step.

## Safety

- Always set `--max-iterations`.
- Use it for tasks with automatic verification (tests, lint, coverage), not for
  design decisions or actions against external systems.
- The plugin does not bypass permissions or approval; normal tool permissions
  still apply.

## Development

```bash
cd packages/plugins/ralph-loop
bun test
bun typecheck
```
