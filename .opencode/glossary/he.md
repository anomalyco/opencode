# he Glossary

## Sources

- Hebrew Academy approved IT terminology: https://terms.hebrew-academy.org.il/Millonim/ShowMillon?KodMillon=192
- Firefox Hebrew localization corpus: https://github.com/mozilla-l10n/firefox-l10n/tree/main/he
- KDE Hebrew localization team and corpus: https://l10n.kde.org/team-infos.php?teamcode=he
- Community-maintained VS Code Hebrew language pack: https://github.com/AMAARETS/vscode-language-pack-he
- Microsoft Hebrew developer documentation for Git terminology: https://learn.microsoft.com/he-il/power-platform/alm/tutorials/github-actions-deploy
- W3C guidance for bidirectional text: https://www.w3.org/International/articles/strings-and-bidi/

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose and UI copy)
- `API`, `MCP`, `LSP`, `OAuth`, `Git`, model names, and provider names
- Commands, flags, keyboard shortcuts, file paths, URLs, identifiers, hashes, and code literals
- Keep `commit` and `diff` when they name the exact Git artifact or operation

## Preferred Terms

| English / Context | Preferred     | Notes                                                                     |
| ----------------- | ------------- | ------------------------------------------------------------------------- |
| session           | `הפעלה`       | Use `שיחה` only when the source specifically means a chat or conversation |
| workspace         | `סביבת עבודה` |                                                                           |
| terminal          | `מסוף`        | Prefer the established Hebrew term over transliteration                   |
| command           | `פקודה`       |                                                                           |
| provider          | `ספק`         | Use `ספק מודלים` where the bare noun is ambiguous                         |
| model             | `מודל`        |                                                                           |
| API key           | `מפתח API`    | Keep the acronym in Latin letters                                         |
| plugin            | `תוסף`        |                                                                           |
| repository        | `מאגר`        | Use `מאגר Git` where context is ambiguous                                 |
| branch            | `ענף`         |                                                                           |
| context           | `הקשר`        | Use `חלון הקשר` for context window                                        |
| tokens            | `אסימונים`    |                                                                           |

## Guidance

- Prefer natural modern Israeli Hebrew over word-for-word translation or obscure coined terms.
- Use short action verbs for controls and translate complete phrases in context.
- Keep recognized developer acronyms and exact Git vocabulary in Latin script instead of phonetic transliteration.
- Treat embedded code, paths, commands, shortcuts, hashes, model IDs, and other Latin technical artifacts as LTR content inside the RTL interface.
- Keep recurring concepts consistent and do not collapse session, chat, run, and launch into one Hebrew term.

## Avoid

- Avoid transliterations such as `טרמינל`, `פלאגין`, and `קומנד` when `מסוף`, `תוסף`, and `פקודה` are clear.
- Avoid translating `commit` as `התחייבות`.
- Avoid inventing Hebrew expansions for `API`, `MCP`, or `LSP`.
