// Language → grammar WASM path mapping for web-tree-sitter
// All grammars are pure-WASM packages (no native compilation required).

import { createRequire } from "module"
import * as nodePath from "path"

const require = createRequire(import.meta.url)

export type SupportedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "bash"
  | "go"
  | "rust"
  | "ruby"
  | "java"
  | "c"
  | "cpp"
  | "css"
  | "html"
  | "json"
  | "yaml"
  | "toml"

function resolve(pkg: string, wasmFile: string): string {
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`)
    return nodePath.join(nodePath.dirname(pkgJson), wasmFile)
  } catch {
    return wasmFile
  }
}

export const LANGUAGE_MAP: Record<SupportedLanguage, string> = {
  typescript: resolve("tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  tsx:        resolve("tree-sitter-typescript", "tree-sitter-tsx.wasm"),
  javascript: resolve("tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  python:     resolve("tree-sitter-python",     "tree-sitter-python.wasm"),
  bash:       resolve("tree-sitter-bash",       "tree-sitter-bash.wasm"),
  go:         resolve("tree-sitter-go",         "tree-sitter-go.wasm"),
  rust:       resolve("tree-sitter-rust",       "tree-sitter-rust.wasm"),
  ruby:       resolve("tree-sitter-ruby",       "tree-sitter-ruby.wasm"),
  java:       resolve("tree-sitter-java",       "tree-sitter-java.wasm"),
  c:          resolve("tree-sitter-c",          "tree-sitter-c.wasm"),
  cpp:        resolve("tree-sitter-cpp",        "tree-sitter-cpp.wasm"),
  css:        resolve("tree-sitter-css",        "tree-sitter-css.wasm"),
  html:       resolve("tree-sitter-html",       "tree-sitter-html.wasm"),
  json:       resolve("tree-sitter-json",       "tree-sitter-json.wasm"),
  yaml:       resolve("tree-sitter-yaml",       "tree-sitter-yaml.wasm"),
  toml:       resolve("tree-sitter-toml",       "tree-sitter-toml.wasm"),
}
