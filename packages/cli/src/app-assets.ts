import { Effect, FileSystem, Option } from "effect"
import { readFileSync } from "node:fs"
import path from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { AppArchive } from "./app-archive"
import { OPENCODE_LOCAL } from "./version"

export type AssetMap = Readonly<Record<string, string | Uint8Array>>
/** Each asset's brotli-compressed bytes, when the build embedded them. */
export type BrotliMap = Readonly<Record<string, Uint8Array>>

export const load = Effect.fn("cli.app-assets.load")(function* () {
  const embedded = yield* Effect.tryPromise(() => import("virtual:opencode-app-assets")).pipe(
    Effect.map((module) => AppArchive.decode(module.default())),
    Effect.option,
  )
  if (Option.isSome(embedded) && (Object.keys(embedded.value).length > 0 || !OPENCODE_LOCAL))
    return {
      files: lazy(embedded.value, (key) => brotliDecompressSync(embedded.value[key]!)),
      brotli: embedded.value,
    }
  if (!OPENCODE_LOCAL) return yield* Effect.fail(new Error("Web UI assets are missing from the CLI build"))
  return { files: yield* sourceAssets(), brotli: undefined }
})

const sourceAssets = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = path.resolve(import.meta.dirname, "../../app/dist")
  const files = yield* fs.readDirectory(root, { recursive: true })
  const assets = Object.fromEntries(
    (yield* Effect.forEach(
      files.filter((file) => !file.endsWith(".map")),
      Effect.fnUntraced(function* (file) {
        // Recursive directory reads use the platform separator; asset keys are URL paths, so normalize to "/".
        const name = file.replaceAll("\\", "/")
        const target = path.join(root, name)
        if ((yield* fs.stat(target)).type === "Directory") return
        return [name, target] as const
      }),
      { concurrency: "unbounded" },
    )).filter((asset) => asset !== undefined),
  )
  return lazy(assets, (key) => readFileSync(assets[key]!))
})

function lazy(assets: Readonly<Record<string, unknown>>, load: (key: string) => Uint8Array): AssetMap {
  // Immutable browser caching makes retaining decompressed copies in the server unnecessary.
  return new Proxy(
    {},
    {
      get: (_, key) => {
        if (typeof key !== "string" || assets[key] === undefined) return
        const body = load(key)
        return isText(key) ? Buffer.from(body).toString() : body
      },
    },
  )
}

function isText(file: string) {
  return file === "_headers" || /\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/.test(file)
}
