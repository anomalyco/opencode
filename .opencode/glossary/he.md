# he Glossary

## Sources

- PR #45205: https://github.com/anomalyco/opencode/pull/45205
- Issue #42447: https://github.com/anomalyco/opencode/issues/42447

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`, `CLI`, `TUI`, `MCP`, `OAuth`, `LSP`, `WSL`, `Git`
- Tool names that are product identifiers: `Shell`, `Grep`, `Glob`, `Webfetch`
- Commands, flags, file paths, URLs, model IDs, and code literals (keep exactly as written)

## Preferred Terms

| English          | Hebrew             | Notes                                                          |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| session          | סשן                | keep the loanword, not "מושב"                                   |
| project          | פרויקט             |                                                                 |
| settings         | הגדרות             |                                                                 |
| sidebar          | סרגל צד            |                                                                 |
| file tree        | עץ קבצים           |                                                                 |
| terminal         | מסוף               |                                                                 |
| workspace        | סביבת עבודה        |                                                                 |
| theme            | נושא               |                                                                 |
| language         | שפה                |                                                                 |
| model            | דגם                |                                                                 |
| provider         | ספק                |                                                                 |
| agent            | סוכן               |                                                                 |
| server           | שרת                |                                                                 |
| permissions      | הרשאות             |                                                                 |
| context          | הקשר               |                                                                 |
| message          | הודעה              |                                                                 |
| question         | שאלה               |                                                                 |
| file             | קובץ               |                                                                 |
| folder           | תיקיה              |                                                                 |
| window           | חלון               |                                                                 |
| update           | עדכון / עדכונים    | use "בדוק עדכונים" for "Check for Updates"                     |
| restart          | הפעלה מחדש         |                                                                 |
| reload           | רענון              |                                                                 |
| view             | תצוגה              |                                                                 |
| edit             | עריכה              |                                                                 |
| change(s)        | שינוי / שינויים    |                                                                 |
| task             | משימה              |                                                                 |
| suggested        | מוצע               |                                                                 |

## Plural Forms

- Hebrew cardinal categories per `Intl.PluralRules("he-IL")`: `one` (n = 1), `two` (n = 2), `other` (including 0 and multiples of 10).
- Any plural family (`{{count}}` string with `.one` and `.other` variants) must also provide a `.two` variant — the parity test derives this automatically from the locale's plural categories.
- Keep `{{count}}` as a bare placeholder in every variant; never merge it into a word.

## Guidance

- Hebrew is RTL: the app renders Hebrew with `dir="rtl"`, but code, commands, flags, paths, and URLs are LTR artifacts — keep their character order unchanged.
- Prefer natural Hebrew phrasing over literal word-for-word translation; keep UI labels short and direct.
- Prefer the masculine plural / neutral form for generic UI copy (e.g., "הודעות" for messages) unless the key is clearly gender-specific.
- Keep the same Hebrew term for the same recurring action across all packages (app, ui, desktop).

## Avoid

- Avoid translating product and protocol names that are fixed identifiers.
- Avoid mixing two Hebrew terms for the same UI action once a preferred term is established.
- Avoid transliterating English into Hebrew script when the English term is a technical identifier (`CLI`, `MCP`, `Webview`).
