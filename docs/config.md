# Config

KanCode loads KanCode config paths only (no project `.opencode/` discovery):

| Kind | Preference |
| --- | --- |
| Project config files | `kancode.json(c)` only (`.jsonc` preferred over `.json`) — do **not** read `opencode.json(c)` |
| Project dirs | `.kancode/` only — do **not** load project `.opencode/`. Use the built-in `import-opencode` skill to copy skills/commands/agents/themes/plans from a legacy `.opencode/` |
| User scope (XDG/global, `~/.kancode`) | KanCode only: `kancode.json(c)` and `.kancode/` — do **not** read `opencode.json` or `~/.opencode` |
| Env flags | Honor `OPENCODE_*`; `KANCODE_*` aliases map to the same flags (`KANCODE_*` wins when both set) |
| XDG / data dirs | Config, data, cache, state, tmp, and managed paths always use `kancode` (create if missing) — no `opencode` fallback |
