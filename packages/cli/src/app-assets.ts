import { Effect, FileSystem, Option } from "effect"
import path from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { OPENCODE_LOCAL } from "./version"

export type AssetMap = Readonly<Record<string, string | Uint8Array>>
type EncodedAssetMap = Readonly<Record<string, { readonly content: string; readonly encoding: "utf8" | "base64" }>>

export const load = Effect.fn("cli.app-assets.load")(function* () {
  const embedded = yield* Effect.tryPromise(() => import("virtual:opencode-app-assets")).pipe(Effect.option)
  if (Option.isSome(embedded) && embedded.value.default.length > 0) return decodeArchive(embedded.value.default)
  if (!OPENCODE_LOCAL) return yield* Effect.fail(new Error("Web UI assets are missing from the CLI build"))
  return decode(yield* sourceAssets())
})

function decodeArchive(archive: string) {
  const body = brotliDecompressSync(Buffer.from(archive, "base64")).toString()
  return decode(JSON.parse(body) as EncodedAssetMap)
}

const sourceAssets = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = path.resolve(import.meta.dirname, "../../app/dist")
  const files = yield* fs.readDirectory(root, { recursive: true })
  return Object.fromEntries(
    (yield* Effect.forEach(
      files.filter((file) => !file.endsWith(".map")),
      Effect.fnUntraced(function* (file) {
        const target = path.join(root, file)
        if ((yield* fs.stat(target)).type === "Directory") return
        const body = Buffer.from(yield* fs.readFile(target))
        const encoding = isText(file) ? "utf8" : "base64"
        return [file, { encoding, content: body.toString(encoding) }] as const
      }),
      { concurrency: "unbounded" },
    )).filter((asset) => asset !== undefined),
  )
})

function decode(assets: EncodedAssetMap): AssetMap {
  return Object.fromEntries(
    Object.entries(assets).map(([key, asset]) => [
      key,
      asset.encoding === "utf8" ? asset.content : Buffer.from(asset.content, "base64"),
    ]),
  )
}

function isText(file: string) {
  return file === "_headers" || /\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/.test(file)
}
