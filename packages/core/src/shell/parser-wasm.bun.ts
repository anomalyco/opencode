// @ts-ignore Bun embeds static file imports when compiling the CLI.
import runtime from "web-tree-sitter/tree-sitter.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import bash from "tree-sitter-bash/tree-sitter-bash.wasm" with { type: "file" }
// @ts-ignore Bun embeds static file imports when compiling the CLI.
import powershell from "tree-sitter-powershell/tree-sitter-powershell.wasm" with { type: "file" }

export const shellParserWasm = { runtime, bash, powershell }
