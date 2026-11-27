# uk Glossary

## Sources

- Review of the desktop app's Ukrainian UI copy

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `LSP`, `OAuth` (never transliterate them as `МКП` or `ЛСП`)
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

| English                                          | Preferred                      | Notes                                                                       |
| ------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------- |
| session                                          | сесія                          | Not `сеанс`                                                                 |
| project                                          | проєкт                         | 2019 orthography, not `проект`                                              |
| worktree                                         | робоче дерево                  | Not `робоча область` or `робоче місце`                                      |
| Experimental (settings tab)                      | Експериментальні функції       | Not the bare adjective `Експериментальний`                                  |
| shell (tool, activity category, mode)            | Термінал                       | `Використано: Читання, Запис, Термінал`; `режим термінала`                  |
| shell (a running command or process)             | команда                        | `3 команди`, `запущено 2 команди`, `Очікування команди`, `Зупинити команду` |
| shell command                                    | команда термінала              | `Введіть команду термінала…`                                                |
| shell (bash, zsh, PowerShell chosen in settings) | оболонка                       | Only where the user picks the shell program itself                          |
| terminal (genitive)                              | термінала                      | Not `терміналу`                                                             |
| About (settings tab)                             | Про OpenCode                   | Not a bare `Про`                                                            |
| third-party notices                              | ліцензії сторонніх компонентів | Not `повідомлення третіх сторін`                                            |
| Released under the MIT License                   | Поширюється за ліцензією MIT   |                                                                             |

## Guidance

- Prefer natural Ukrainian phrasing over literal translation
- Keep tone clear and direct in UI labels and docs prose
- Fill every plural form the locale uses: `.one`, `.few`, `.many`, `.other`
- Keep the English punctuation of short taglines when it reads naturally (for example `OpenCode, агент кодування з відкритим кодом`)
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths

## Avoid

- Avoid `оболонка` for shell activity, counts, and tool labels; it reads as jargon next to `Читання` and `Запис`
- Avoid translating product and protocol names that are fixed identifiers
- Avoid mixing multiple Ukrainian terms for the same recurring UI action once a preferred term is established
