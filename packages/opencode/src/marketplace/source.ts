import path from "path"
import { Effect, Layer, Context } from "effect"
import { Global } from "@opencode-ai/core/global"
import { MARKETPLACE_CACHE_DIR } from "./types"

export interface FetchResult {
  readonly dir: string
  readonly sourceUrl: string
}

export interface Interface {
  readonly fetch: (pkgName: string, source: string) => Effect.Effect<FetchResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceSource") {}

const cloneGitHub = (
  pkgName: string,
  source: string,
  cacheRoot: string,
): Effect.Effect<FetchResult> =>
  Effect.gen(function* () {
    const repo = source.replace(/^(github:|gh:)/, "")
    const dest = path.join(cacheRoot, pkgName)

    const valid = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const entries = await import("fs/promises").then((f) => f.readdir(dest))
        return entries.length > 0 && entries.some((e) => e !== ".git")
      } catch {
        return false
      }
    })
    if (valid) return { dir: dest, sourceUrl: `https://github.com/${repo}` }
    yield* Effect.promise(() => import("fs/promises").then((f) => f.rm(dest, { recursive: true, force: true })))

    const url = `https://github.com/${repo}.git`
    const result = yield* Effect.promise(() =>
      import("@/util/process").then(({ Process }) =>
        Process.run(["git", "clone", "--depth", "1", url, dest], { nothrow: true }),
      ),
    )
    if (result.code === 0) return { dir: dest, sourceUrl: `https://github.com/${repo}` }
    return yield* Effect.fail(new Error(`Failed to clone ${url}`))
  }).pipe(Effect.catch(() => Effect.succeed({ dir: "", sourceUrl: "" } as FetchResult)))

const cloneGitLab = (
  pkgName: string,
  source: string,
  cacheRoot: string,
): Effect.Effect<FetchResult> =>
  Effect.gen(function* () {
    const repo = source.replace(/^(gitlab:|gl:)/, "")
    const dest = path.join(cacheRoot, pkgName)

    const valid = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const entries = await import("fs/promises").then((f) => f.readdir(dest))
        return entries.length > 0 && entries.some((e) => e !== ".git")
      } catch {
        return false
      }
    })
    if (valid) return { dir: dest, sourceUrl: `https://gitlab.com/${repo}` }
    yield* Effect.promise(() => import("fs/promises").then((f) => f.rm(dest, { recursive: true, force: true })))

    const url = `https://gitlab.com/${repo}.git`
    const result = yield* Effect.promise(() =>
      import("@/util/process").then(({ Process }) =>
        Process.run(["git", "clone", "--depth", "1", url, dest], { nothrow: true }),
      ),
    )
    if (result.code === 0) return { dir: dest, sourceUrl: `https://gitlab.com/${repo}` }
    return yield* Effect.fail(new Error(`Failed to clone ${url}`))
  }).pipe(Effect.catch(() => Effect.succeed({ dir: "", sourceUrl: "" } as FetchResult)))

const downloadUrl = (
  pkgName: string,
  url: string,
  cacheRoot: string,
): Effect.Effect<FetchResult> =>
  Effect.gen(function* () {
    const dest = path.join(cacheRoot, pkgName)

    const valid = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const entries = await import("fs/promises").then((f) => f.readdir(dest))
        return entries.length > 0
      } catch {
        return false
      }
    })
    if (valid) return { dir: dest, sourceUrl: url }
    yield* Effect.promise(() => import("fs/promises").then((f) => f.rm(dest, { recursive: true, force: true })))

    const buf = yield* Effect.promise((): Promise<ArrayBuffer | null> =>
      globalThis.fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    )
    if (!buf) return yield* Effect.fail(new Error(`Failed to download ${url}`))

    const tmp = `${dest}.tmp`
    yield* Effect.promise(() => import("fs/promises").then((f) => f.writeFile(tmp, Buffer.from(buf))))
    yield* Effect.promise(() => import("fs/promises").then((f) => f.mkdir(dest, { recursive: true })))
    yield* Effect.promise(async () => {
      const { execSync } = await import("child_process")
      try {
        execSync(`tar -xzf "${tmp}" -C "${dest}" 2>/dev/null`, { stdio: "ignore" })
      } catch {
        execSync(`unzip -o "${tmp}" -d "${dest}" 2>/dev/null`, { stdio: "ignore" })
      }
    })
    yield* Effect.promise(() => import("fs/promises").then((f) => f.unlink(tmp)))
    return { dir: dest, sourceUrl: url }
  }).pipe(Effect.catch(() => Effect.succeed({ dir: "", sourceUrl: "" } as FetchResult)))

const copyLocal = (
  pkgName: string,
  filePath: string,
  cacheRoot: string,
): Effect.Effect<FetchResult> =>
  Effect.gen(function* () {
    const dest = path.join(cacheRoot, pkgName)

    const valid = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const entries = await import("fs/promises").then((f) => f.readdir(dest))
        return entries.length > 0
      } catch {
        return false
      }
    })
    if (valid) return { dir: dest, sourceUrl: filePath }
    yield* Effect.promise(() => import("fs/promises").then((f) => f.rm(dest, { recursive: true, force: true })))

    yield* Effect.promise(() => import("fs/promises").then((f) => f.mkdir(dest, { recursive: true })))
    const resolved = filePath.startsWith("/") ? filePath : path.resolve(filePath)
    yield* Effect.promise(() => import("fs/promises").then((f) => f.cp(resolved, dest, { recursive: true })))
    return { dir: dest, sourceUrl: resolved }
  }).pipe(Effect.catch(() => Effect.succeed({ dir: "", sourceUrl: "" } as FetchResult)))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const cacheRoot = path.join(global.cache, MARKETPLACE_CACHE_DIR)

    const fetch: Interface["fetch"] = (pkgName: string, source: string) =>
      Effect.gen(function* () {
        if (source.startsWith("github:") || source.startsWith("gh:")) {
          return yield* cloneGitHub(pkgName, source, cacheRoot)
        }
        if (source.startsWith("gitlab:") || source.startsWith("gl:")) {
          return yield* cloneGitLab(pkgName, source, cacheRoot)
        }
        if (source.startsWith("http://") || source.startsWith("https://")) {
          return yield* downloadUrl(pkgName, source, cacheRoot)
        }
        return yield* copyLocal(pkgName, source, cacheRoot)
      })

    return Service.of({ fetch })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Global.defaultLayer),
)
