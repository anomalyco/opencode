import { $ } from "bun"
import path from "node:path"
import { brotliCompressSync, constants } from "node:zlib"
import { AppArchive } from "../src/app-archive"
import { collectFiles } from "./files"

export async function buildAppArchive(channel: string, options?: { skipBuild?: boolean }) {
  if (options?.skipBuild) return AppArchive.encode([])
  const root = path.resolve(import.meta.dirname, "../../app")
  await $`bun run build`
    .cwd(root)
    .env({ ...process.env, OPENCODE_CHANNEL: channel, VITE_OPENCODE_SERVER_MODE: "origin" })
  return AppArchive.encode(
    await Promise.all(
      (await collectFiles(path.join(root, "dist")))
        .map((key) => key.replaceAll(path.sep, "/"))
        .filter((key) => !key.endsWith(".map"))
        .toSorted()
        .map(async (key) => {
          const body = Buffer.from(await Bun.file(path.join(root, "dist", key)).arrayBuffer())
          // Independent entries let the server materialize only assets the browser requests.
          return [key, compress(body)] as const
        }),
    ),
  )
}

function compress(body: Buffer) {
  return brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  })
}
