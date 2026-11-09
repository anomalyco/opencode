// local-only: Node-Variante der lokalen Tree-sitter-Parser. Der Node-Build kopiert assets/tree-sitter nach
// $OPENCODE_NODE_ASSETS_DIR/@opencode/tui/tree-sitter (packages/cli/script/node-assets.ts); ohne Build werden die
// Dateien direkt aus dem Paket gelesen.
import path from "node:path"
import { fileURLToPath } from "node:url"
import manifest from "../assets/tree-sitter/manifest.json" with { type: "json" }

const root = process.env.OPENCODE_NODE_ASSETS_DIR
  ? path.join(process.env.OPENCODE_NODE_ASSETS_DIR, "@opencode/tui/tree-sitter")
  : fileURLToPath(new URL("../assets/tree-sitter/", import.meta.url))

const resolve = (rel: string) => path.join(root, rel)

export const parsers = manifest.map((parser) => ({
  ...parser,
  wasm: resolve(parser.wasm),
  queries: Object.fromEntries(
    Object.entries(parser.queries).map(([kind, rels]) => [kind, (rels as string[]).map(resolve)]),
  ),
}))
