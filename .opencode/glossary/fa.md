# fa Glossary

## Sources

No PR-backed guidance yet. Add entries here when review PRs introduce repeated wording corrections.

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`, `LSP`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

| English  | Preferred  | Notes                                     |
| -------- | ---------- | ----------------------------------------- |
| agent    | عامل       | preferred                                 |
| prompt   | پرامپت     | preferred; keep `prompt` in code/commands |
| session  | نشست       | preferred                                 |
| provider | ارائه‌دهنده | preferred                                 |
| config   | پیکربندی   | preferred                                 |

## Guidance

- Prefer natural Persian phrasing over literal translation
- Keep tone clear and direct in UI labels and docs prose
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- For RTL text, treat code, commands, and paths as LTR artifacts and keep their character order unchanged
- Use Persian (Farsi) ی and ک (U+06CC, U+06A9), not the Arabic variants, and use ZWNJ (نیم‌فاصله) where appropriate

## Avoid

- Avoid translating product and protocol names that are fixed identifiers
- Avoid mixing multiple Persian terms for the same recurring UI action once a preferred term is established
