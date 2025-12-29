#!/usr/bin/env bun

import fs from "fs"
import path from "path"

/**
 * Rewrite tree-sitter wasm references inside a JS file to absolute paths.
 * argv: [node, script, file, mainWasm, ...wasmPaths]
 */
const [, , file, mainWasm, ...wasmPaths] = process.argv

if (!file || !mainWasm) {
  console.error("usage: patch-wasm <file> <mainWasm> [wasmPaths...]")
  process.exit(1)
}

const content = fs.readFileSync(file, "utf8")
const byName = new Map<string, string>()

for (const wasm of wasmPaths) {
  const name = path.basename(wasm)
  byName.set(name, wasm)
}

let next = content

for (const [name, wasmPath] of byName) {
  next = next.replaceAll(name, wasmPath)
}

next = next.replaceAll("tree-sitter.wasm", mainWasm).replaceAll("web-tree-sitter/tree-sitter.wasm", mainWasm)

// Collapse any relative prefixes before absolute store paths (e.g., "../../../..//nix/store/...")
const nixStorePrefix = process.env.NIX_STORE || "/nix/store"
next = next.replace(/(\.\/)+/g, "./")
next = next.replace(
  new RegExp(`(\\.\\.\\/)+\\/{1,2}(${nixStorePrefix.replace(/^\//, "").replace(/\//g, "\\/")}[^"']+)`, "g"),
  "/$2",
)
next = next.replace(new RegExp(`(["'])\\/{2,}(\\/${nixStorePrefix.replace(/\//g, "\\/")}[^"']+)(["'])`, "g"), "$1$2$3")
next = next.replace(new RegExp(`(["'])\\/\\/(${nixStorePrefix.replace(/\//g, "\\/")}[^"']+)(["'])`, "g"), "$1$2$3")

if (next !== content) fs.writeFileSync(file, next)
