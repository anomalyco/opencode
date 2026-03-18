# th Glossary

## Sources

- PR #10809: https://github.com/anomalyco/opencode/pull/10809
- PR #11496: https://github.com/anomalyco/opencode/pull/11496

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

These are PR-backed preferences and may evolve.

| English / Context                     | Preferred             | Notes                                                                            |
| ------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| Thai language label in language lists | `ไทย`                 | PR #10809 standardized this across locales                                       |
| Language names in language pickers    | Native names (static) | PR #11496: keep names like `English`, `Deutsch`, `ไทย` consistent across locales |

## Guidance

- Prefer natural Thai phrasing over literal translation
- Keep tone short and clear for buttons and labels
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- Keep language names static/native in language pickers instead of translating them per current locale (PR #11496)

## Avoid

- Avoid translating language names differently per current locale in language lists
- Avoid changing `ไทย` to another display form for the Thai language option unless the product standard changes
