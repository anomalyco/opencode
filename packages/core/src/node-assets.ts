import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

export const shellParserWasmAssets = {
  runtime: "web-tree-sitter/tree-sitter.wasm",
  bash: "tree-sitter-bash/tree-sitter-bash.wasm",
  powershell: "tree-sitter-powershell/tree-sitter-powershell.wasm",
} as const

export function resolveNodeAsset(key: string) {
  if (process.env.OPENCODE_NODE_ASSETS_DIR) return path.join(process.env.OPENCODE_NODE_ASSETS_DIR, key)
  return require.resolve(key)
}

export function getCoreNodeAssets() {
  return Object.values(shellParserWasmAssets).map((key) => ({ key, source: require.resolve(key) }))
}
