import { $ } from "bun"
import { readdir } from "node:fs/promises"
import path from "node:path"

export type AppAsset = {
  readonly key: string
  readonly source: string
  readonly content: string
  readonly encoding: "utf8" | "base64"
}

export async function buildAppAssets(channel: string) {
  const root = path.resolve(import.meta.dirname, "../../app")
  await $`bun run build`.cwd(root).env({ ...process.env, OPENCODE_CHANNEL: channel })
  return Promise.all(
    (await files(path.join(root, "dist")))
      .filter((key) => !key.endsWith(".map"))
      .map(async (key): Promise<AppAsset> => {
        const source = path.join(root, "dist", key)
        const body = Buffer.from(await Bun.file(source).arrayBuffer())
        const encoding = isText(key) ? "utf8" : "base64"
        return { key, source, encoding, content: body.toString(encoding) }
      }),
  )
}

function isText(key: string) {
  return key === "_headers" || /\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/.test(key)
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
