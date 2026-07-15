# fa Glossary

## Sources

- PR #0: https://github.com/anomalyco/opencode/pull/0 (initial Farsi translation)

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`, `LLM`, `API`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

| English         | Preferred (فارسی) | Notes                                              |
| --------------- | ----------------- | -------------------------------------------------- |
| agent           | عامل              | recurring UI/docs term                             |
| session         | نشست              |                                                    |
| prompt          | درخواست           | `پرامپت` also acceptable in informal contexts      |
| tool            | ابزار             |                                                    |
| command         | دستور             |                                                    |
| configuration   | پیکربندی          |                                                    |
| provider        | ارائه‌دهنده       | LLM provider                                       |
| model           | مدل               |                                                    |
| permission      | مجوز              |                                                    |
| key             | کلید              | API key → کلید API                                 |
| theme           | تم                |                                                    |
| plugin          | افزونه            |                                                    |
| skill           | مهارت             |                                                    |
| message         | پیام              |                                                    |
| function        | تابع              |                                                    |
| file            | پرونده            | or `فایل` in informal contexts                     |
| directory       | فهرست             | or `پوشه` in informal contexts                     |
| install         | نصب               |                                                    |

## Guidance

- Prefer natural Farsi phrasing over literal translation
- Keep tone clear and direct in UI labels and docs prose
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- For RTL text, treat code, commands, and paths as LTR artifacts and keep their character order unchanged
- `OpenCode` is a proper noun; keep its casing. Use `opencode` only inside code, commands, and paths.
- Use Persian numerals in prose when natural; keep Western digits inside code, versions, and commands.

## Avoid

- Avoid translating product and protocol names that are fixed identifiers
- Avoid mixing multiple Farsi terms for the same recurring UI action once a preferred term is established
- Avoid translating `agent` as `نماینده` in product context; prefer `عامل`
