import { $ } from "bun"
import { readdir } from "node:fs/promises"
import path from "node:path"

export type AppAsset = {
  readonly key: string
  readonly source: string
}

export async function buildAppAssets(channel: string) {
  const root = path.resolve(import.meta.dirname, "../../app")
  await $`bun run build`.cwd(root).env({ ...process.env, OPENCODE_CHANNEL: channel })
  return (await files(path.join(root, "dist")))
    .filter((key) => !key.endsWith(".map"))
    .map((key): AppAsset => ({ key, source: path.join(root, "dist", key) }))
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
