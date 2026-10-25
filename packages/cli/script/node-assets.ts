import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getNodeAssets } from "@opentui/core/node-assets"
import { attentionSoundAssets, type NodeTarget, photonWasmAsset, shellParserWasmAssets } from "../src/node/target"
import { collectFiles } from "./files"
import { resolveOpencodePty } from "./opencode-pty"

const dir = path.resolve(import.meta.dirname, "..")

// Bun's compiler discovers file imports and embeds them in its virtual filesystem. Vite only bundles the JavaScript
// portion of the Node executable, while SEA embeds only the assets explicitly listed in its build configuration.
// Collect and stage those files under stable keys so the SEA prelude can extract them to real paths at startup;
// native addons, helper executables, and other path-based consumers cannot use assets directly from SEA memory.
export type NodeAsset = {
  readonly key: string
  readonly source: string
}

export async function collectNodeAssets(target: NodeTarget) {
  const opencodePty = await resolveOpencodePty({
    platform: target.platform,
    arch: target.arch,
    ...(target.platform === "linux" ? { libc: "glibc" as const } : {}),
  })
  const ptyEntry = fileURLToPath(import.meta.resolve(target.nodePtyPackage))
  const ptyRoot = path.resolve(path.dirname(ptyEntry), "..")
  const assets: NodeAsset[] = [
    ...getNodeAssets({
      platform: target.platform,
      arch: target.arch,
      ...(target.platform === "linux" ? { libc: "glibc" as const } : {}),
    }),
    { key: target.parcelWatcherAsset, source: fileURLToPath(import.meta.resolve(target.parcelWatcherPackage)) },
    { key: target.fffAsset, source: fileURLToPath(import.meta.resolve(target.fffPackage)) },
    { key: target.fffFfiAsset, source: fileURLToPath(import.meta.resolve(target.fffFfiPackage)) },
    {
      key: photonWasmAsset,
      source: fileURLToPath(import.meta.resolve(photonWasmAsset)),
    },
    ...Object.values(shellParserWasmAssets).map((key) => ({
      key,
      source: fileURLToPath(import.meta.resolve(key)),
    })),
    ...attentionSoundAssets.map((key) => ({
      key,
      source: path.resolve(dir, "../ui/src/assets/audio", path.basename(key)),
    })),
    ...(opencodePty && target.opencodePtyAsset ? [{ key: target.opencodePtyAsset, source: opencodePty.source }] : []),
    ...(await collectFiles(ptyRoot))
      .filter((relative) => !relative.endsWith(".map") && !relative.endsWith(".pdb"))
      .map((relative) => ({
        key: `${target.nodePtyPackage}/${relative}`,
        source: path.join(ptyRoot, relative),
      })),
  ]
  const unique = [...new Map(assets.map((asset) => [asset.key, asset])).values()]
  await Promise.all(unique.map((asset) => stat(asset.source)))
  return unique
}

export async function hashNodeAssets(assets: readonly NodeAsset[]) {
  const hash = createHash("sha256")
  for (const asset of assets.toSorted((left, right) => left.key.localeCompare(right.key))) {
    hash.update(asset.key)
    hash.update(await readFile(asset.source))
  }
  return hash.digest("hex").slice(0, 16)
}

export async function copyNodeAssets(assets: readonly NodeAsset[]) {
  const root = path.join(dir, "dist-node", "assets")
  await Promise.all(
    assets.map(async (asset) => {
      const target = path.join(root, asset.key)
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(asset.source, target)
    }),
  )
}

export async function seaAssetMap() {
  const root = path.join(dir, "dist-node", "assets")
  return Object.fromEntries(
    (await collectFiles(root)).map((key) => [key.replaceAll(path.sep, "/"), path.join(root, key)]),
  )
}
