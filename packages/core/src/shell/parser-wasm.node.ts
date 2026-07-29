import { resolveNodeAsset, shellParserWasmAssets } from "../node-assets"

export const shellParserWasm = {
  runtime: resolveNodeAsset(shellParserWasmAssets.runtime),
  bash: resolveNodeAsset(shellParserWasmAssets.bash),
  powershell: resolveNodeAsset(shellParserWasmAssets.powershell),
}
