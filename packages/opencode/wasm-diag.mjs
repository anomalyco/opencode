import { fileURLToPath } from "node:url"
import { Language } from "web-tree-sitter"

const { Parser } = await import("web-tree-sitter")
const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm", { with: { type: "wasm" } })
console.log("[diag] treeWasm typeof:", typeof treeWasm)
console.log("[diag] treeWasm value:", String(treeWasm).slice(0, 200))

const resolveWasm = (asset) => {
  if (typeof asset === "string") {
    if (asset.startsWith("file://")) return fileURLToPath(asset)
    if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
    return fileURLToPath(new URL(asset, import.meta.url))
  }
  console.error("[diag] resolveWasm: asset is NOT a string:", typeof asset, String(asset).slice(0, 200))
  return asset
}

const treePath = resolveWasm(treeWasm)
console.log("[diag] treePath:", treePath)

try {
  await Parser.init({ locateFile: () => treePath })
  console.log("[diag] Parser.init OK")
} catch (e) {
  console.error("[diag] Parser.init FAILED:", e)
  process.exit(1)
}

const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm", { with: { type: "wasm" } })
const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm", { with: { type: "wasm" } })
const bashPath = resolveWasm(bashWasm)
const psPath = resolveWasm(psWasm)
console.log("[diag] bashPath:", bashPath)
console.log("[diag] psPath:", psPath)
try {
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  const tree = bash.parse("ls -la")
  console.log("[diag] parse:", tree ? "OK" : "no tree")
} catch (e) {
  console.error("[diag] grammar load FAILED:", e)
  process.exit(1)
}
console.log("[diag] ALL OK")
