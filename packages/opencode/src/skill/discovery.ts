import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient, path } from "@opencode-ai/core/effect/layer-node-platform"
import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Option, Path, Schema, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"

const skillConcurrency = 4
const fileConcurrency = 8

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
  version: Schema.optional(Schema.String),
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillDiscovery") {}

export const layer: Layer.Layer<Service, never, FSUtil.Service | Path.Path | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const path = yield* Path.Path
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const cache = path.join(Global.Path.cache, "skills")
    const manifestPath = path.join(cache, "versions.json")
    const parseManifest = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
    const decodeManifest = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))

    const readManifest = Effect.fn("Discovery.readManifest")(function* () {
      const text = yield* fs.readFileString(manifestPath).pipe(Effect.catch(() => Effect.succeed("")))
      return Option.getOrElse(Option.flatMap(parseManifest(text), decodeManifest), () => ({}) as Record<string, string>)
    })

    const writeManifest = Effect.fn("Discovery.writeManifest")(function* (manifest: Record<string, string>) {
      yield* fs.ensureDir(cache).pipe(Effect.orDie)
      yield* fs.writeFileString(manifestPath, JSON.stringify(manifest, null, 2)).pipe(
        Effect.catch((err) => Effect.logError("failed to persist skill version manifest", { error: err })),
      )
    })

    const download = Effect.fn("Discovery.download")(function* (url: string, dest: string, force = false) {
      if (!force && (yield* fs.exists(dest).pipe(Effect.orDie))) return true

      return yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.flatMap((res) => res.arrayBuffer),
        Effect.flatMap((body) => fs.writeWithDirs(dest, new Uint8Array(body))),
        Effect.as(true),
        Effect.catch((err) => Effect.logError("failed to download", { url: url, error: err }).pipe(Effect.as(false))),
      )
    })

    const pull = Effect.fn("Discovery.pull")(function* (url: string) {
      const base = url.endsWith("/") ? url : `${url}/`
      const index = new URL("index.json", base).href
      const host = base.slice(0, -1)

      yield* Effect.logInfo("fetching index", { url: index })

      const data = yield* HttpClientRequest.get(index).pipe(
        HttpClientRequest.acceptJson,
        http.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
        Effect.catch((err) =>
          Effect.logError("failed to fetch index", { url: index, error: err }).pipe(Effect.as(null)),
        ),
      )

      if (!data) return []

      const missing = data.skills.filter((skill) => !skill.files.includes("SKILL.md"))
      yield* Effect.forEach(
        missing,
        (skill) => Effect.logWarning("skill entry missing SKILL.md", { url: index, skill: skill.name }),
        { discard: true },
      )
      const list = data.skills.filter((skill) => skill.files.includes("SKILL.md"))

      const manifest = yield* readManifest()
      const next: Record<string, string> = {}

      const dirs = yield* Effect.forEach(
        list,
        (skill) =>
          Effect.gen(function* () {
            const root = path.join(cache, skill.name)
            const force = skill.version !== undefined && manifest[skill.name] !== skill.version

            yield* Effect.forEach(
              skill.files,
              (file) => download(new URL(file, `${host}/${skill.name}/`).href, path.join(root, file), force),
              {
                concurrency: fileConcurrency,
              },
            )

            const md = path.join(root, "SKILL.md")
            const exists = yield* fs.exists(md).pipe(Effect.orDie)
            if (exists && skill.version !== undefined) next[skill.name] = skill.version
            return exists ? root : null
          }),
        { concurrency: skillConcurrency },
      )

      if (Object.keys(next).length > 0 || Object.keys(manifest).length > 0) yield* writeManifest(next)
      return dirs.filter((dir): dir is string => dir !== null)
    })

    return Service.of({ pull })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(NodePath.layer),
)

export const node = LayerNode.make(layer, [FSUtil.node, path, httpClient])

export * as Discovery from "./discovery"
