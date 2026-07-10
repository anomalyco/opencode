import path from "node:path"
import { fileURLToPath } from "node:url"
import { webTreeSitterWasmAsset } from "./target"

const root = process.env.OPENCODE_NODE_ASSETS_DIR ?? fileURLToPath(new URL("./assets/", import.meta.url))

export function resolveNodeAsset(asset: string) {
  return path.join(root, asset)
}

export function resolveOpenTuiAsset(relative: string) {
  return resolveNodeAsset(`@opentui/core/${relative}`)
}

export function resolveWebTreeSitterWasm() {
  return resolveNodeAsset(webTreeSitterWasmAsset)
}
