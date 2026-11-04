# H06: grammars outside the default build, and grammar versions

TypeScript: Core highlights with its six bundled grammars and the TUI's 34 from `packages/tui/src/parsers-config.ts`.
It downloads each grammar's WASM and highlight queries on first use, caches them under
`~/.local/share/opentui/tree-sitter`, and rewrites `#lua-match?` to `#match?` as it loads them.

Rust: `opencode_ui::grammars` links the grammars statically and registers them with the same queries. The queries are
generated into `assets/queries` by `script/gen/grammars.ts`, which reads Core's cache first, as Core does, and applies
Core's rewrite. They use Core's capture rules (`Grammar::core_captures`) and Core's theme fallback
(`SyntaxTheme::first_part_fallback`). `crates/ui/tests/all/grammars.rs` and `content.rs` match the TypeScript renders cell
for cell. Here is what still differs:

- **The default build links 14 grammars:** JavaScript, TypeScript, TSX, Markdown, Zig, Rust, Python, Go, bash, HTML,
  JSON, YAML, CSS, and diff. The other 23 need `--features opencode-ui/grammars-all`. Without that feature, their code
  shows in the text color. Reason: each grammar is a C parser that compiles once per target directory, and this keeps
  the default build small.
- **Kotlin is not linked.** TS uses fwcd's `tree-sitter-kotlin` 0.3.8, and that crate needs tree-sitter older than
  0.23. fwcd's `main` (0.4.0) builds, but the 0.3.8 query does not load against it (`Invalid node type "null"`). Kotlin
  shows in the text color.
- **Swift is not linked, and neither client highlights it.** The cached TS query fails against the 0.7.1 grammar in
  web-tree-sitter too (`Bad node name 'nil_literal'`), so Core skips Swift.
- **F#: two patterns are dropped.** They are `(_type (long_identifier (identifier) @type.builtin))` and the attribute
  pattern that captures `@attribute` and `@constant`. tree-sitter 0.27 rejects them as impossible, but web-tree-sitter
  0.25 loads them, so TS may highlight built-in type names and attributes that Rust leaves plain.
- **Other grammar versions, all in `grammars-all`.** Vue uses `tree-sitter-vue-next` 0.1.0 (TS: anomalyco's fork
  0.1.2). Clojure uses `tree-sitter-clojure-orchard` 0.2.9 (TS: anomalyco's fork 0.0.1). Vim uses `tree-sitter-vim` 0.4.0
  (TS: 0.8.1). Nix uses `tree-sitter-nix` 0.3.0 (TS: a WASM build from ast-grep). The crates TS pins at these versions
  need an older tree-sitter or do not exist on crates.io. The queries load against all four, so the node names agree.
  The parses can still differ on syntax that the grammar versions handle differently.
- **Rust and Markdown use opentui-rust's crate versions:** `tree-sitter-rust` 0.24.2 (TS: 0.24.0) and
  `tree-sitter-md` 0.5.4 (TS: 0.5.1). Cargo allows one version per crate in a build.
- **Markdown injections are opentui-rust's,** not the nvim-treesitter query Core uses. Core's query names a fence's
  language with a directive only Core implements. The fences, HTML, front matter, and inline text inject the same
  grammars, so the colors are Core's (`U.4a/markdown-fences`, `U.4b/markdown`).

Reason: static linking instead of runtime downloads (plan H06). The client cannot download and load WASM grammars
without a WASM runtime, and the Rust crates exist for nearly every language.
