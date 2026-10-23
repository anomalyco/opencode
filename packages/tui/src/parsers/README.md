# Bundled tree-sitter grammars

These grammars publish no wasm build, so the TUI embeds one. Each directory holds the
grammar's wasm, its own `queries/highlights.scm` from the same commit, and its license.
`haml/injections.scm` is local: the grammar's own injections use capture names opentui does
not read. The `sql` and `ini` queries drop `@spell` from their comment capture:
the TUI theme colors `spell` as plain text, which would override the comment color.

| Language | Source | Commit |
| --- | --- | --- |
| sql | [DerekStride/tree-sitter-sql](https://github.com/DerekStride/tree-sitter-sql) `v0.3.11` | `7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8` |
| dockerfile | [camdencheek/tree-sitter-dockerfile](https://github.com/camdencheek/tree-sitter-dockerfile) | `971acdd908568b4531b0ba28a445bf0bb720aba5` |
| ini | [justinmk/tree-sitter-ini](https://github.com/justinmk/tree-sitter-ini) | `e4018b5176132b4f3c5d6e61cea383f42288d0f5` |
| haml | [vitallium/tree-sitter-haml](https://github.com/vitallium/tree-sitter-haml) | `b2f317a57cca67c445ae925149911a88e53e6c7b` |

Rebuild one with tree-sitter CLI 0.25.10 and Docker, from a checkout at that commit:

```sh
tree-sitter generate   # only when src/parser.c is not committed (sql)
tree-sitter build --wasm --docker -o tree-sitter-<language>.wasm .
```
