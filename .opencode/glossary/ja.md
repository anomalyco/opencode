# ja Glossary

## Sources

- PR #9821: https://github.com/anomalyco/opencode/pull/9821
- PR #13160: https://github.com/anomalyco/opencode/pull/13160

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

These are PR-backed wording preferences and may evolve.

| English / Context           | Preferred               | Notes                                 |
| --------------------------- | ----------------------- | ------------------------------------- |
| WSL integration (UI label)  | `WSL連携`               | PR #13160 prefers this over `WSL統合` |
| WSL integration description | `WindowsのWSL環境で...` | PR #13160 improved phrasing naturally |

## Guidance

- Prefer natural Japanese phrasing over literal translation
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- In WSL integration text, follow PR #13160 wording direction for more natural Japanese phrasing

## Avoid

- Avoid `WSL統合` in the WSL integration UI context where `WSL連携` is the reviewed wording
- Avoid translating product and protocol names that are fixed identifiers
