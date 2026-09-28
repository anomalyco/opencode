import { fileURLToPath } from "node:url"
import { Language } from "web-tree-sitter"

async function run() {
  try {
    const { Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm", { with: { type: "wasm" } })
    self.postMessage({ step: "import", wasmType: typeof treeWasm, value: String(treeWasm).slice(0, 200) })

    const resolveWasm = (asset) => {
      if (typeof asset === "string") {
        if (asset.startsWith("file://")) return fileURLToPath(asset)
        if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
        return fileURLToPath(new URL(asset, import.meta.url))
      }
      self.postMessage({ step: "resolveWasm-non-string", assetType: typeof asset, asset: String(asset).slice(0, 200) })
      return asset
    }

    const treePath = resolveWasm(treeWasm)
    self.postMessage({ step: "treePath", treePath: String(treePath) })
    await Parser.init({ locateFile: () => treePath })
    self.postMessage({ step: "parser-init-ok" })

    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm", { with: { type: "wasm" } })
    const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm", { with: { type: "wasm" } })
    const bashPath = resolveWasm(bashWasm)
    const psPath = resolveWasm(psWasm)
    self.postMessage({ step: "grammar-paths", bashPath: String(bashPath), psPath: String(psPath) })

    const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
    const bash = new Parser()
    bash.setLanguage(bashLanguage)
    const ps = new Parser()
    ps.setLanguage(psLanguage)
    const tree = bash.parse("ls -la")
    self.postMessage({ step: "parse", ok: !!tree })
    self.postMessage({ step: "worker-all-ok" })
  } catch (e) {
    self.postMessage({ step: "failed", error: String((e && e.stack) || e) })
  }
}

self.onmessage = (e) => {
  if (e.data === "run") run()
}
