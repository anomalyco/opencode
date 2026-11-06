export * as SkillDiscovery from "./discovery.js"

import path from "path"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { AbsolutePath } from "../schema.js"
import { Hash } from "@opencode/util/hash"
import { RemoteHttp } from "../remote-http.js"

/** Records the version of a downloaded skill inside its cache directory. It is not part of the skill. */
export const versionFile = ".opencode-version"
// Config activation waits for skill sources, so an unresponsive catalog fails instead of holding it.
const requestTimeout = "30 seconds"
const skillConcurrency = 4
const fileConcurrency = 8

export function isSafeSegment(value: string) {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  )
}

export function isSafeRelativePath(value: string) {
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
        return isSafeSegment(decodeURIComponent(segment))
      } catch {
        return false
      }
    })
  )
}

class IndexSkill extends Schema.Class<IndexSkill>("SkillDiscovery.IndexSkill")({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  files: Schema.Array(Schema.String),
}) {}

class Index extends Schema.Class<Index>("SkillDiscovery.Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  /**
   * Downloads the skills listed in `<url>/index.json` into the cache and returns their directories. `headers` go with
   * every request to the source and its same-origin redirects. The cache is keyed by URL alone, so rotating headers
   * reuses it.
   */
  readonly pull: (url: string, headers?: Readonly<Record<string, string>>) => Effect.Effect<AbsolutePath[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillDiscovery") {}

const layer = Layer.effect(
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
    )

    const download = Effect.fn("SkillDiscovery.download")(function* (
      url: string,
      destination: string,
      headers: Readonly<Record<string, string>> | undefined,
    ) {
      if (yield* fs.exists(destination).pipe(Effect.orDie)) return true
      return yield* RemoteHttp.get(http, url, headers).pipe(
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.scoped,
        Effect.timeout(requestTimeout),
        Effect.flatMap((body) => fs.writeWithDirs(destination, new Uint8Array(body))),
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logError("failed to download skill file", { url, error }).pipe(Effect.as(false)),
        ),
      )
    })

    return Service.of({
      pull: Effect.fn("SkillDiscovery.pull")(function* (url, headers) {
        const base = url.endsWith("/") ? url : `${url}/`
        const source = new URL(base)
        const index = new URL("index.json", source).href
        const data = yield* RemoteHttp.follow(
          http,
          HttpClientRequest.get(index).pipe(HttpClientRequest.setHeaders(headers ?? {}), HttpClientRequest.acceptJson),
          Object.keys(headers ?? {}),
        ).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
          Effect.scoped,
          Effect.timeout(requestTimeout),
          Effect.catch((error) =>
            Effect.logError("failed to fetch skill index", { url: index, error }).pipe(Effect.as(undefined)),
          ),
        )
        if (!data) return []

        const sourceRoot = path.resolve(global.cache, "skills", Hash.fast(base))
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
            const marker = path.join(root, versionFile)
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
                file,
              }
            })
            if (!files.every((file): file is { url: string; destination: string; file: string } => file !== undefined))
              return []
            return [{ skill, root, marker, files }]
          }),
          ({ skill, root, marker, files }) =>
            Effect.gen(function* () {
              const version = skill.version
              const current =
                version === undefined
                  ? undefined
                  : yield* fs.readFileStringSafe(marker).pipe(Effect.orElseSucceed(() => undefined))
              if (version === undefined || current === version) {
                yield* Effect.forEach(files, (file) => download(file.url, file.destination, headers), {
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
                    (file) => download(file.url, path.resolve(staging, file.file), headers),
                    { concurrency: fileConcurrency },
                  )
                  if (!downloaded.every(Boolean)) return
                  const exists =
                    (yield* fs.exists(path.join(staging, "SKILL.md")).pipe(Effect.orDie)) ||
                    (yield* fs.exists(path.join(staging, `${skill.name}.md`)).pipe(Effect.orDie))
                  if (!exists) return
                  yield* fs.writeFileString(path.join(staging, versionFile), version)
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
              const exists =
                (yield* fs.exists(path.join(root, "SKILL.md")).pipe(Effect.orDie)) ||
                (yield* fs.exists(path.join(root, `${skill.name}.md`)).pipe(Effect.orDie))
              return exists ? [AbsolutePath.make(root)] : []
            }),
          { concurrency: skillConcurrency },
        ).pipe(Effect.map((directories) => directories.flat()))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [httpClient, FSUtil.node, Global.node] })
