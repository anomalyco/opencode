# no Glossary

## Sources

- PR #10018: https://github.com/anomalyco/opencode/pull/10018
- PR #12935: https://github.com/anomalyco/opencode/pull/12935

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Sound names (PR #10018 notes these were intentionally left untranslated)

## Preferred Terms

These are PR-backed corrections and may evolve.

| English / Context                   | Preferred    | Notes                         |
| ----------------------------------- | ------------ | ----------------------------- |
| Save (data persistence action)      | `Lagre`      | Prefer over `Spare`           |
| Disabled (feature/state)            | `deaktivert` | Prefer over `funksjonshemmet` |
| API keys                            | `API Nøkler` | Prefer over `API Taster`      |
| Cost (noun)                         | `Kostnad`    | Prefer over verb form `Koste` |
| Show/View (imperative button label) | `Vis`        | Prefer over `Utsikt`          |

## Guidance

- Prefer natural Norwegian Bokmal (Bokmål) wording over literal translation
- Keep tone clear and practical in UI labels
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- Keep recurring UI terms consistent once a preferred term is chosen

## Avoid

- Avoid `Spare` for save actions in persistence contexts
- Avoid `funksjonshemmet` for disabled feature states
- Avoid `API Taster`, `Koste`, and `Utsikt` in the corrected contexts above
