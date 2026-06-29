import { Effect, Layer, Context, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { PackageEntry, RegistryIndex } from "./types"

export interface Interface {
  readonly fetchIndex: (url: string) => Effect.Effect<readonly PackageEntry[]>
  readonly scanLocal: (dir: string) => Effect.Effect<readonly PackageEntry[]>
  readonly all: () => Effect.Effect<readonly PackageEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceRegistry") {}

const DEFAULT_REGISTRIES: ReadonlyArray<{ url?: string; local?: string }> = [
  { url: "https://raw.githubusercontent.com/anomalyco/opencode-registry/main/index.json" },
]

const decodeIndex = (data: unknown): RegistryIndex | null => {
  try {
    return Schema.decodeUnknownSync(RegistryIndex)(data)
  } catch {
    return null
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const fetchIndex: Interface["fetchIndex"] = (url: string) =>
      Effect.gen(function* () {
        const body = yield* HttpClientRequest.get(url).pipe(
          HttpClientRequest.acceptJson,
          http.execute,
          Effect.flatMap((res) => res.json),
          Effect.catch(() => Effect.succeed(null)),
        )
        if (!body) return []

        const parsed = decodeIndex(body)
        return parsed?.packages ?? []
      })

    const scanLocal: Interface["scanLocal"] = (dir: string) =>
      Effect.gen(function* () {
        const indexPath = dir.endsWith(".json") ? dir : `${dir}/index.json`
        const exists = yield* fs.existsSafe(indexPath).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return []

        const buf = yield* fs.readFileStringSafe(indexPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!buf) return []

        let parsed: RegistryIndex | null = null
        try {
          const raw = JSON.parse(buf)
          parsed = decodeIndex(raw)
        } catch {
          return []
        }
        if (!parsed) return []

        return parsed.packages.map((pkg) => {
          const src = pkg.source as Record<string, unknown>
          if (src?.type === "local") {
            const p = src.path as string
            const resolved = p.startsWith("/") ? p : `${dir}/${p}`
            return new PackageEntry({
              ...pkg,
              source: { type: "local" as const, path: resolved },
            })
          }
          return pkg
        })
      })

    const all: Interface["all"] = () =>
      Effect.gen(function* () {
        const results: PackageEntry[] = []

        for (const reg of DEFAULT_REGISTRIES) {
          if (reg.url) {
            const entries = yield* fetchIndex(reg.url)
            results.push(...entries)
          }
          if (reg.local) {
            const entries = yield* scanLocal(reg.local)
            results.push(...entries)
          }
        }

        const localRegDir = `${global.config}/registry`
        const localExists = yield* fs.existsSafe(localRegDir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (localExists) {
          const entries = yield* scanLocal(localRegDir)
          results.push(...entries)
        }

        return results
      })

    return Service.of({ fetchIndex, scanLocal, all })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
)
