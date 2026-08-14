import { $ } from "bun"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { brotliCompressSync, constants } from "node:zlib"

export async function buildAppArchive(channel: string, options?: { skipBuild?: boolean }) {
  if (options?.skipBuild) return compress({})
  const root = path.resolve(import.meta.dirname, "../../app")
  await $`bun run build`.cwd(root).env({ ...process.env, OPENCODE_CHANNEL: channel })
  const assets = Object.fromEntries(
    await Promise.all(
      (await files(path.join(root, "dist")))
        .filter((key) => !key.endsWith(".map"))
        .map(async (key) => {
          const source = path.join(root, "dist", key)
          const body = Buffer.from(await Bun.file(source).arrayBuffer())
          const encoding = isText(key) ? "utf8" : "base64"
          return [key, { encoding, content: body.toString(encoding) }] as const
        }),
    ),
  )
  return compress(assets)
}

function compress(assets: object) {
  return brotliCompressSync(JSON.stringify(assets), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).toString("base64")
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
