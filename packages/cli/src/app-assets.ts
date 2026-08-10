import { readdir } from "node:fs/promises"
import path from "node:path"

export type AssetMap = Readonly<Record<string, string>>

let result: Promise<AssetMap> | undefined

export function load() {
  return (result ??= import("virtual:opencode-app-assets")
    .then((module) => module.default)
    .catch(() => ({}))
    .then((assets) => (Object.keys(assets).length > 0 ? assets : sourceAssets())))
}

async function sourceAssets(): Promise<AssetMap> {
  const root = path.resolve(import.meta.dirname, "../../app/dist")
  const entries = await files(root).catch(() => [])
  return Object.fromEntries(entries.filter((file) => !file.endsWith(".map")).map((file) => [file, path.join(root, file)]))
}

async function files(root: string, current = root): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(current, { withFileTypes: true })).map((entry) => {
        const target = path.join(current, entry.name)
        return entry.isDirectory() ? files(root, target) : [path.relative(root, target).replaceAll(path.sep, "/")]
      }),
    )
  )
    .flat()
    .toSorted()
}
