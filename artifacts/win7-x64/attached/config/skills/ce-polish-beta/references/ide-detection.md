# IDE detection for browser handoff

Polish attempts to hand the running dev-server URL off to an IDE's embedded browser so the user can test without a context switch. Detection is best-effort — failure falls through to printing the URL in the interactive summary.

## Detection order

Probe environment variables in this order and stop at the first positive match. Earlier entries are more specific; later entries are general fallbacks.

| Order | Signal | IDE | Handoff method |
|-------|--------|-----|----------------|
| 1 | `CLAUDE_CODE` env var set (any value) | Claude Code desktop | Print `claude-code://browser?url=http://localhost:<port>` as a clickable hint; Claude Code's desktop app intercepts `claude-code://` URLs. |
| 2 | `CURSOR_TRACE_ID` env var set | Cursor | Emit `cursor://anysphere.cursor-retrieval/open?url=...` if Cursor's URL scheme is stable in the user's version; otherwise print the URL with a note to open it in Cursor's simple-browser view. |
| 3 | `TERM_PROGRAM=vscode` AND no Cursor/Claude Code signal | Plain VS Code | Print the URL with a hint: `Open in VS Code: Ctrl+Shift+P → "Simple Browser: Show" → paste URL`. |
| 4 | None of the above | Terminal / unknown IDE | Print the URL. No handoff attempt. |

## Why env-var probe, not a fancier approach

- Env vars are cross-platform (macOS, Linux, Windows/WSL)
- They fail open — if a probe returns nothing, polish still works
- They don't require any IDE API or socket connection
- They encode "is this shell running inside a known IDE" without guessing

## Codex and other platforms

Codex (Claude Agent SDK, Gemini CLI, etc.) do not yet expose an embedded-browser handoff. For these platforms, polish falls through to the terminal branch (print the URL). When a convention emerges, add a new row to the detection table above.

## Detection failure is never fatal

If environment probing fails or returns ambiguous results, polish prints the URL verbatim and continues. The dev server is already running by this point — the user can always copy-paste the URL into any browser. The IDE handoff is a convenience, not a gate.

## Probe pattern (reference)

The skill consumes these probes inline rather than via a shell script (no state, no parsing, one-shot reads). Typical usage:

```
if [ -n "${CLAUDE_CODE:-}" ]; then
  IDE="claude-code"
elif [ -n "${CURSOR_TRACE_ID:-}" ]; then
  IDE="cursor"
elif [ "${TERM_PROGRAM:-}" = "vscode" ]; then
  IDE="vscode"
else
  IDE="none"
fi
```

Never chain probes with `||` between different variables — a missing env var must resolve to "no signal", not "error". The `${VAR:-}` default-to-empty pattern is mandatory under `set -u`.
