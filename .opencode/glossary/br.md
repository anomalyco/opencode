# br Glossary

## Sources

- PR #10086: https://github.com/anomalyco/opencode/pull/10086

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- Locale code `br` in repo config, code, and paths (repo alias for Brazilian Portuguese)

## Preferred Terms

These are PR-backed locale naming preferences and may evolve.

| English / Context                        | Preferred                      | Notes                                                         |
| ---------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Brazilian Portuguese (prose locale name) | `pt-BR`                        | Use standard locale naming in prose when helpful              |
| Repo locale slug (code/config)           | `br`                           | PR #10086 uses `br` for consistency/simplicity                |
| Browser locale detection                 | `pt`, `pt-br`, `pt-BR` -> `br` | Preserve this mapping in docs/examples about locale detection |

## Guidance

- This file covers Brazilian Portuguese (`pt-BR`), but the repo locale code is `br`
- Use natural Brazilian Portuguese phrasing over literal translation
- Preserve technical artifacts exactly: commands, flags, code, URLs, model IDs, and file paths
- Keep repo locale identifiers as implemented in code/config (`br`) even when prose mentions `pt-BR`

## Avoid

- Avoid changing repo locale code references from `br` to `pt-br` in code snippets, paths, or config examples
- Avoid mixing Portuguese variants when a Brazilian Portuguese form is established
