// Grammar manifest for offline syntax highlighting. `build.ts` resolves
// assets from Nix or the network fetch. The flat asset list lives in
// bundled-grammars.json and is grouped here by language prefix.
import bundledGrammarAssets from "./bundled-grammars.json"

export interface BundledGrammarAsset {
  url: string
  sha256: string
  /** basename used when embedding into $bunfs and when Nix provides the file */
  file: string
}

export interface BundledGrammar {
  wasm: BundledGrammarAsset
  queries: Record<string, BundledGrammarAsset[]>
}

function languagePrefix(file: string): string {
  return file.slice(0, file.indexOf("-"))
}

function groupByLanguage(assets: BundledGrammarAsset[]): Record<string, BundledGrammarAsset[]> {
  const groups: Record<string, BundledGrammarAsset[]> = {}
  for (const asset of assets) {
    const lang = languagePrefix(asset.file)
    ;(groups[lang] ??= []).push(asset)
  }
  return groups
}

function buildGrammar(assets: BundledGrammarAsset[]): BundledGrammar {
  const wasm = assets.find((a) => a.file.endsWith(".wasm"))!
  const queries: Record<string, BundledGrammarAsset[]> = {}
  for (const asset of assets) {
    if (asset === wasm) continue
    // e.g. "python-highlights.scm" -> "highlights", "vue-highlights-2.scm" -> "highlights"
    const rest = asset.file.slice(languagePrefix(asset.file).length + 1)
    const key = rest.replace(/-?\d+\.scm$/, ".scm").replace(/\.scm$/, "")
    ;(queries[key] ??= []).push(asset)
  }
  return { wasm, queries }
}

export const bundledGrammars: Record<string, BundledGrammar> = Object.fromEntries(
  Object.entries(groupByLanguage(bundledGrammarAssets)).map(([lang, assets]) => [lang, buildGrammar(assets)]),
)
