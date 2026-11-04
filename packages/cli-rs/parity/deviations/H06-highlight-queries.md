# H06: highlight queries until U.4b

TypeScript: Core highlights code with nvim-treesitter's queries (`packages/tui/src/parsers-config.ts`). For
TypeScript, that query names `import` and `export` `keyword.import` and `keyword.export`, and `function` `keyword.function`.
It names member properties `property`, and it adds `@spell` to comments. The syntax style then gives `spell` the text
color, so comments show in the text color, italic.

Rust: opentui-rust bundles each grammar's own highlight query, which names those `keyword`, `property` and
`comment`, and has no `@spell`. With the same syntax theme, those tokens come out in other colors or attributes. In
`parity/fixtures/U.4a/code.json`, `diff.json` and `markdown-fences.json`, `import`, `export` and `function` are italic `syntax.keyword`
instead of plain `syntax.keyword` and `syntax.function`, and comments are `syntax.comment` instead of `text.base`.

The syntax theme itself matches: `code::syntax_theme` equals `generateSyntax` scope for scope
(`parity/fixtures/U.4a/syntax.json`). The difference comes only from the capture names.

Separately, `SyntaxTheme::get` falls back from an unstyled `a.b.c` to the longest styled prefix (`a.b`), and Core
falls back to `a`. No capture in the corpus shows this.

Reason: an opentui-rust difference not yet aligned. U.4b links the grammars with the TypeScript queries and removes
this file. `crates/ui/tests/content.rs` exempts only foreground and attributes on the listed rows, not text or
backgrounds.
