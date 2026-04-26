// Language → grammar WASM path mapping for web-tree-sitter
// All grammars must be available as WASM files loadable by web-tree-sitter.
// TypeScript grammar ships inside the tree-sitter-typescript npm package.
// Bash grammar ships inside tree-sitter-bash.
// Python/JS grammars ship inside their respective tree-sitter-* packages.
//
// The paths below use require.resolve to locate the WASM file at runtime,
// which works with both bun and node module resolution.

import { createRequire } from "module"

const require = createRequire(import.meta.url)

export type SupportedLanguage = "typescript" | "tsx" | "javascript" | "python" | "bash"

function resolve(pkg: string, wasmFile: string): string {
  try {
    // Try resolving from the package's dist/wasm or root
    const base = require.resolve(`${pkg}/package.json`)
    return base.replace("package.json", wasmFile)
  } catch {
    return wasmFile
  }
}

export const LANGUAGE_MAP: Record<SupportedLanguage, string> = {
  typescript: resolve("tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  tsx: resolve("tree-sitter-typescript", "tree-sitter-tsx.wasm"),
  javascript: resolve("tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  python: resolve("tree-sitter-python", "tree-sitter-python.wasm"),
  bash: resolve("tree-sitter-bash", "tree-sitter-bash.wasm"),
}
