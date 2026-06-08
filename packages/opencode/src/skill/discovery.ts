import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"

const skillConcurrency = 4
const fileConcurrency = 8

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
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

    const download = Effect.fn("Discovery.download")(function* (url: string, dest: string) {
      if (yield* fs.exists(dest).pipe(Effect.orDie)) return true

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

      const dirs = yield* Effect.forEach(
        list,
        (skill) =>
          Effect.gen(function* () {
            const root = path.join(cache, skill.name)

            yield* Effect.forEach(
              skill.files,
              (file) => download(new URL(file, `${host}/${skill.name}/`).href, path.join(root, file)),
              {
                concurrency: fileConcurrency,
              },
            )

            const md = path.join(root, "SKILL.md")
            return (yield* fs.exists(md).pipe(Effect.orDie)) ? root : null
          }),
        { concurrency: skillConcurrency },
      )

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

export * as Discovery from "./discovery"
