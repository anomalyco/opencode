# bs Glossary

## Sources

- PR #12283: https://github.com/anomalyco/opencode/pull/12283

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

These are PR-backed locale naming preferences and may evolve.

| English / Context                  | Preferred  | Notes                                             |
| ---------------------------------- | ---------- | ------------------------------------------------- |
| Bosnian language label (UI)        | `Bosanski` | PR #12283 tested switching language to `Bosanski` |
| Repo locale slug (code/config)     | `bs`       | Preserve in code, config, paths, and examples     |
| Browser locale detection (Bosnian) | `bs`       | PR #12283 added `bs` locale auto-detection        |

## Guidance

- Use natural Bosnian phrasing over literal translation
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- Keep repo locale references as `bs` in code/config, and use `Bosanski` for the user-facing language name when applicable

## Avoid

- Avoid changing repo locale references from `bs` to another slug in code snippets or config examples
- Avoid translating product and protocol names that are fixed identifiers
