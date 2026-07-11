import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient, path } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import nodePath from "path"

const skillConcurrency = 4
const fileConcurrency = 8

// ---------------------------------------------------------------------------
// Validate remote index fields so skill.name / files cannot escape the cache.
// ---------------------------------------------------------------------------

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
    !nodePath.posix.isAbsolute(value) &&
    !nodePath.win32.isAbsolute(value) &&
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

const layer: Layer.Layer<Service, never, FSUtil.Service | Path.Path | HttpClient.HttpClient> = Layer.effect(
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
      const source = new URL(base)
      const index = new URL("index.json", source).href

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

      const entries = data.skills.flatMap((skill) => {
        if (!isSafeSegment(skill.name)) {
          return []
        }
        if (!skill.files.includes("SKILL.md")) {
          return []
        }

        const root = nodePath.resolve(cache, skill.name)
        if (!FSUtil.contains(cache, root) || root === cache) {
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

          const destination = nodePath.resolve(root, file)
          if (!FSUtil.contains(root, destination) || destination === root) return undefined
          return {
            url: resource.href,
            destination,
            file,
          }
        })
        if (files.some((item) => item === undefined)) {
          return []
        }
        return [
          {
            skill,
            root,
            files: files as { url: string; destination: string; file: string }[],
          },
        ]
      })

      const missing = data.skills.filter(
        (skill) => isSafeSegment(skill.name) && !skill.files.includes("SKILL.md"),
      )
      yield* Effect.forEach(
        missing,
        (skill) => Effect.logWarning("skill entry missing SKILL.md", { url: index, skill: skill.name }),
        { discard: true },
      )

      const dirs = yield* Effect.forEach(
        entries,
        ({ skill, root, files }) =>
          Effect.gen(function* () {
            const versionFile = path.join(root, ".opencode-version")
            const version = skill.version
            const current =
              version === undefined
                ? undefined
                : yield* fs.readFileStringSafe(versionFile).pipe(Effect.catch(() => Effect.succeed(undefined)))

            if (version === undefined || current === version) {
              yield* Effect.forEach(files, (file) => download(file.url, file.destination), {
                concurrency: fileConcurrency,
                discard: true,
              })
            } else {
              const token = crypto.randomUUID()
              const staging = `${root}.tmp-${token}`
              const backup = `${root}.old-${token}`
              yield* Effect.gen(function* () {
                const downloaded = yield* Effect.forEach(
                  files,
                  (file) => download(file.url, nodePath.resolve(staging, file.file)),
                  { concurrency: fileConcurrency },
                )
                if (!downloaded.every(Boolean)) return
                if (!(yield* fs.exists(path.join(staging, "SKILL.md")).pipe(Effect.orDie))) return
                yield* fs.writeFileString(path.join(staging, ".opencode-version"), version)
                yield* Effect.uninterruptible(
                  Effect.gen(function* () {
                    const cached = yield* fs.exists(root).pipe(Effect.orDie)
                    if (cached) yield* fs.rename(root, backup)
                    yield* fs.rename(staging, root).pipe(
                      Effect.catch((error) =>
                        Effect.gen(function* () {
                          if (cached) yield* fs.rename(backup, root).pipe(Effect.ignore)
                          return yield* Effect.fail(error)
                        }),
                      ),
                    )
                    if (cached) yield* fs.remove(backup, { recursive: true, force: true }).pipe(Effect.ignore)
                  }),
                )
              }).pipe(
                Effect.catch((error) => Effect.logError("failed to refresh skill", { skill: skill.name, error })),
                Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
              )
            }
            return (yield* fs.exists(path.join(root, "SKILL.md")).pipe(Effect.orDie)) ? root : null
          }),
        { concurrency: skillConcurrency },
      )

      return dirs.filter((dir): dir is string => dir !== null)
    })

    return Service.of({ pull })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, path, httpClient] })

export * as Discovery from "./discovery"
