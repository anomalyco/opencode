export * as SkillDiscovery from "./discovery"

import path from "path"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { AbsolutePath } from "../schema"

const skillConcurrency = 4
const fileConcurrency = 8

function isSafeSegment(value: string) {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  )
}

function isSafeRelativePath(value: string) {
  const segments = value.split("/")
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !URL.canParse(value) &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    segments.every((segment) => {
      try {
        const decoded = decodeURIComponent(segment)
        return (
          decoded.length > 0 &&
          decoded !== "." &&
          decoded !== ".." &&
          !decoded.includes("/") &&
          !decoded.includes("\\") &&
          !decoded.includes("\0")
        )
      } catch {
        return false
      }
    })
  )
}

class IndexSkill extends Schema.Class<IndexSkill>("SkillDiscovery.IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
}) {}

class Index extends Schema.Class<Index>("SkillDiscovery.Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<AbsolutePath[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SkillDiscovery") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.retryTransient({
        retryOn: "errors-and-responses",
        times: 2,
        schedule: Schedule.exponential(200).pipe(Schedule.jittered),
      }),
      HttpClient.filterStatusOk,
    )

    const download = Effect.fn("SkillDiscovery.download")(function* (url: string, destination: string) {
      if (yield* fs.exists(destination).pipe(Effect.orDie)) return
      yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.flatMap((body) => fs.writeWithDirs(destination, new Uint8Array(body))),
        Effect.catch((error) => Effect.logError("failed to download skill file", { url, error })),
      )
    })

    return Service.of({
      pull: Effect.fn("SkillDiscovery.pull")(function* (url) {
        const base = url.endsWith("/") ? url : `${url}/`
        const source = new URL(base)
        const index = new URL("index.json", source).href
        const data = yield* HttpClientRequest.get(index).pipe(
          HttpClientRequest.acceptJson,
          http.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
          Effect.catch((error) =>
            Effect.logError("failed to fetch skill index", { url: index, error }).pipe(Effect.as(undefined)),
          ),
        )
        if (!data) return []

        const sourceRoot = path.resolve(global.cache, "skills", Bun.hash(base).toString(16))
        return yield* Effect.forEach(
          data.skills.flatMap((skill) => {
            if (!isSafeSegment(skill.name)) {
              return []
            }
            if (!skill.files.includes("SKILL.md") && !skill.files.includes(`${skill.name}.md`)) {
              return []
            }

            const root = path.resolve(sourceRoot, skill.name)
            if (!FSUtil.contains(sourceRoot, root) || root === sourceRoot) {
              return []
            }

            const skillUrl = new URL(`${encodeURIComponent(skill.name)}/`, source)
            const files = skill.files.map((file) => {
              if (!isSafeRelativePath(file)) return undefined
              let resource: URL
              try {
                resource = new URL(file, skillUrl)
              } catch {
                return undefined
              }
              if (resource.origin !== source.origin) return undefined

              const destination = path.resolve(root, file)
              if (!FSUtil.contains(root, destination) || destination === root) return undefined
              return {
                url: resource.href,
                destination,
              }
            })
            if (files.some((file) => file === undefined)) {
              return []
            }
            return [{ skill, root, files: files as { url: string; destination: string }[] }]
          }),
          ({ skill, root, files }) =>
            Effect.gen(function* () {
              yield* Effect.forEach(files, (file) => download(file.url, file.destination), {
                concurrency: fileConcurrency,
                discard: true,
              })
              return (yield* fs.exists(path.join(root, "SKILL.md")).pipe(Effect.orDie)) ||
                (yield* fs.exists(path.join(root, `${skill.name}.md`)).pipe(Effect.orDie))
                ? [AbsolutePath.make(root)]
                : []
            }),
          { concurrency: skillConcurrency },
        ).pipe(Effect.map((directories) => directories.flat()))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
)
