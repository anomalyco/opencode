# U.4b: grammars

The TypeScript TUI highlights with Core's six bundled grammars and the 34 of `packages/tui/src/parsers-config.ts`,
using the nvim-treesitter queries named there (plan Q11 "a": match colors). The Rust client links the grammars
statically and uses the same queries.

## Crates

opentui-rust's `tree-sitter` feature already links JavaScript, TypeScript and TSX, Markdown, Zig, and Rust
(`opentui/Cargo.toml`). `opencode-ui` depends on those crates at the same versions and reuses them, so none links twice.
It registers them again with Core's queries instead of the crate queries.

The default `grammars` feature adds the languages transcripts show most:

| Filetype | Crate | TS WASM |
| --- | --- | --- |
| python | `tree-sitter-python` 0.23.6 | 0.23.6 |
| go | `tree-sitter-go` 0.25.0 | 0.25.0 |
| bash | `tree-sitter-bash` 0.25.0 | 0.25.0 |
| html | `tree-sitter-html` 0.23.2 | 0.23.2 |
| json | `tree-sitter-json` 0.24.8 | 0.24.8 |
| yaml | `tree-sitter-yaml` 0.7.2 | 0.7.2 |
| css | `tree-sitter-css` 0.25.0 | 0.25.0 |
| diff (`udiff`, `patch`) | `tree-sitter-diff` 0.1.0 | 0.1.0 |

`grammars-all` adds the rest. These crates are pinned to the TS WASM release where crates.io has it: agda 1.3.3, c
0.24.1, c-sharp 0.23.1, cpp 0.23.4, elixir 0.3.5, fsharp 0.3.0, haskell 0.23.1, java 0.23.5, julia 0.23.1, lua 0.5.0,
make 1.1.1 (`makefile`), ocaml 0.24.2, php 0.24.2 (`LANGUAGE_PHP_ONLY`), r 1.2.0, ruby 0.23.1, scala 0.24.0, toml-ng
0.7.0, and xml 0.7.0. hcl 1.2.0 comes from its git tag. Four use substitutes, because the pinned crate needs an older
tree-sitter or is not on crates.io: `tree-sitter-vue-next` 0.1.0, `tree-sitter-clojure-orchard` 0.2.9,
`tree-sitter-vim` 0.4.0, and `tree-sitter-nix` 0.3.0. Kotlin and Swift are not linked:
`parity/deviations/H06-highlight-queries.md` gives the reasons.

## Build time

This is the extra cost of the `grammars` feature over the `oc-rust` tip. It was measured once with `nice -n 10 cargo
build -p opencode-ui`, in the dev profile, on this shared machine. The baseline first built everything without the
feature (`--no-default-features`).

| Build | Wall | CPU (user) |
| --- | --- | --- |
| Cold: the eight grammar crates and `opencode-ui` | 3.3 s | 5.4 s |
| Warm: nothing changed | 0.08 s | 0.06 s |

The grammar crates never rebuild after the first build: a change in the client only relinks. `cargo check
--features grammars-all` compiles the other 23 crates' C parsers in 24.6 s wall (86 s CPU). A cold `cargo build` of
`grammars-all` was not measured.

## Queries

`script/gen/grammars.ts` writes `assets/queries/<filetype>/highlights.scm` and `assets/queries/manifest.json`, which
lists each filetype with its aliases and sources:

- TUI grammars: each source of `parsers-config.ts`, read as Core's `DownloadUtils` reads it. It tries Core's cache
  (`~/.local/share/opentui/tree-sitter/queries/<filetype>-<hash>.scm`) first and downloads on a miss, then joins the
  sources with newlines. Some sources follow a moving branch (swift's `main`). The cache holds what TUI users load.
- Core's grammars: the queries bundled in `@opentui/core`'s `assets/`.
- Every query then gets Core's `translateLuaMatch`, which turns a simple `#lua-match?` into `#match?`. JavaScript's
  `[^]` is written as `(?s:.)` for Rust's `regex`.

Locals queries are not copied, because Core does not use them. Only Markdown has injections, opentui-rust's version of
Core's (see H06).

## Registration

`opencode_ui::grammars::register()` runs once per process. `code::view`, `markdown::view`, and `diff::view` call it.
Each grammar is registered with `Grammar::core_captures()`. A grammar whose query fails to compile is logged and
skipped, as Core skips it. A pattern that tree-sitter 0.27 proves can never match is dropped first, and the query is
compiled again: tree-sitter 0.27 rejects such a pattern where web-tree-sitter 0.25 accepts it. Only F# has such
patterns.

## Capture semantics (opentui-rust)

Core's queries assume Core's capture handling, which opentui-rust did not have. Two opt-in additions match it:

- `Grammar::core_captures` keeps every capture of a node, so `(comment) @comment @spell` styles with both. It orders
  the captures as Core cascades them: by the number of dotted parts, then by start. It drops `markup.raw.block` inside a
  capture that contains injected text.
- `SyntaxTheme::first_part_fallback` resolves a name without a style to its first dotted part, as Core's
  `SyntaxStyle.getStyle` does. `string.special.path` then takes `string`, not `string.special`. `code::syntax_theme`
  sets it.

## Proof

- `crates/ui/tests/all/grammars.rs` (P-COMP): one snippet per grammar of the default build except TypeScript
  (`parity/fixtures/U.4b/corpus.json`). Each is rendered by `parity/component/U.4b-grammars.tsx` in `<code>` with
  the TUI's parsers registered, and by `code::view`. Every cell is equal, colors and attributes included.
- `crates/ui/tests/all/content.rs`: the U.4a fixtures (TypeScript code, diff, Markdown fences) now match with no
  exemptions.
- `grammars::tests`: every query compiles under `grammars-all`, the table matches the manifest, and TypeScript
  captures `keyword.import` and `spell`.
