import { $ } from "bun"
import path from "node:path"
import { brotliCompressSync, constants } from "node:zlib"
import { collectFiles } from "./files"

export async function buildAppArchive(channel: string, options?: { skipBuild?: boolean }) {
  if (options?.skipBuild) return compress({})
  const root = path.resolve(import.meta.dirname, "../../app")
  await $`bun run build`.cwd(root).env({ ...process.env, OPENCODE_CHANNEL: channel })
  const assets = Object.fromEntries(
    await Promise.all(
      (await collectFiles(path.join(root, "dist")))
        .map((key) => key.replaceAll(path.sep, "/"))
        .filter((key) => !key.endsWith(".map"))
        .toSorted()
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
