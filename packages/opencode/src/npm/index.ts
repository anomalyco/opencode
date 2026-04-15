import path from "path"
import semver from "semver"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { NamedError } from "@opencode-ai/util/error"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Global } from "../global"
import { Log } from "../util/log"
import { Flock } from "@/util/flock"
import { Arborist } from "@npmcli/arborist"
import { NpmConfig } from "./config"
import { withTransientReadRetry } from "@/util/effect-http-client"

export namespace Npm {
  const log = Log.create({ service: "npm" })
  const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

  export const InstallFailedError = NamedError.create(
    "NpmInstallFailedError",
    z.object({
      pkg: z.string(),
    }),
  )

  export interface Interface {
    readonly add: (
      pkg: string,
    ) => Effect.Effect<
      { directory: string; entrypoint: string | undefined },
      Error | AppFileSystem.Error | InstanceType<typeof InstallFailedError>
    >
    readonly install: (dir: string) => Effect.Effect<void, Error | AppFileSystem.Error>
    readonly outdated: (pkg: string, cachedVersion: string) => Effect.Effect<boolean>
    readonly which: (
      pkg: string,
    ) => Effect.Effect<string | undefined, Error | AppFileSystem.Error | InstanceType<typeof InstallFailedError>>
  }

  type Pkg = {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }

  type Lock = {
    packages?: Record<string, Pkg>
  }

  type Bin = {
    bin?: string | Record<string, string>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Npm") {}

  export function sanitize(pkg: string) {
    if (!illegal) return pkg
    return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
  }

  function directory(pkg: string) {
    return path.join(Global.Path.cache, "packages", sanitize(pkg))
  }

  function resolveEntryPoint(name: string, dir: string) {
    let entrypoint: string | undefined
    try {
      entrypoint = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
    } catch {}
    return {
      directory: dir,
      entrypoint,
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const cfg = yield* NpmConfig.Service
      const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))

      const create = Effect.fnUntraced(function* (dir: string) {
        return new Arborist({
          path: dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
          ...(yield* cfg.config(dir)),
        })
      })

      const lock = <A, E>(key: string, body: Effect.Effect<A, E>) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.promise(() => Flock.acquire(key)).pipe(Effect.orDie), (lease) =>
              Effect.promise(() => lease.release()).pipe(Effect.orDie),
            )
            return yield* body
          }),
        )

      const readPkg = <A>(file: string, fallback: A) =>
        fs.readJson(file).pipe(
          Effect.catch(() => Effect.succeed(fallback)),
          Effect.map((value) => value as A),
        )

      const reify = Effect.fnUntraced(function* (dir: string) {
        const arb = yield* create(dir)
        yield* Effect.promise(() => arb.reify()).pipe(Effect.catch(() => Effect.void))
      })

      const outdated = Effect.fn("Npm.outdated")(function* (pkg: string, cachedVersion: string) {
        const url = `https://registry.npmjs.org/${pkg}`
        const data = yield* HttpClientRequest.get(url).pipe(
          HttpClientRequest.acceptJson,
          http.execute,
          Effect.flatMap((res) => res.json),
          Effect.catch(() =>
            Effect.sync(() => {
              log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
              return undefined
            }),
          ),
        )

        const latestVersion =
          data &&
          typeof data === "object" &&
          "dist-tags" in data &&
          data["dist-tags"] &&
          typeof data["dist-tags"] === "object"
            ? (data["dist-tags"] as { latest?: string }).latest
            : undefined

        if (!latestVersion) {
          log.warn("No latest version found, using cached", { pkg, cachedVersion })
          return false
        }

        const range = /[\s^~*xX<>|=]/.test(cachedVersion)
        if (range) return !semver.satisfies(latestVersion, cachedVersion)
        return semver.lt(cachedVersion, latestVersion)
      })

      const add = Effect.fn("Npm.add")(function* (pkg: string) {
        const dir = directory(pkg)
        const key = `npm-install:${AppFileSystem.resolve(dir)}`

        return yield* lock(
          key,
          Effect.gen(function* () {
            log.info("installing package", { pkg })
            const arb = yield* create(dir)
            const tree = yield* Effect.promise(() => arb.loadVirtual()).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            const cached = tree?.edgesOut.values().next().value?.to
            if (cached) return resolveEntryPoint(cached.name, cached.path)

            const result = yield* Effect.tryPromise({
              try: () => arb.reify({ add: [pkg], save: true, saveType: "prod" }),
              catch: (cause) =>
                new InstallFailedError(
                  { pkg },
                  {
                    cause,
                  },
                ),
            })

            const first = result.edgesOut.values().next().value?.to
            if (!first) return yield* Effect.fail(new InstallFailedError({ pkg }))
            return resolveEntryPoint(first.name, first.path)
          }),
        )
      })

      const install = Effect.fn("Npm.install")(function* (dir: string) {
        const key = `npm-install:${dir}`
        yield* lock(
          key,
          Effect.gen(function* () {
            log.info("checking dependencies", { dir })

            if (!(yield* fs.existsSafe(path.join(dir, "node_modules")))) {
              log.info("node_modules missing, reifying")
              yield* reify(dir)
              return
            }

            const pkg = yield* readPkg<Pkg>(path.join(dir, "package.json"), {})
            const lock = yield* readPkg<Lock>(path.join(dir, "package-lock.json"), {})
            const declared = new Set([
              ...Object.keys(pkg.dependencies || {}),
              ...Object.keys(pkg.devDependencies || {}),
              ...Object.keys(pkg.peerDependencies || {}),
              ...Object.keys(pkg.optionalDependencies || {}),
            ])

            const root = lock.packages?.[""] || {}
            const locked = new Set([
              ...Object.keys(root.dependencies || {}),
              ...Object.keys(root.devDependencies || {}),
              ...Object.keys(root.peerDependencies || {}),
              ...Object.keys(root.optionalDependencies || {}),
            ])

            for (const name of declared) {
              if (locked.has(name)) continue
              log.info("dependency not in lock file, reifying", { name })
              yield* reify(dir)
              return
            }

            log.info("dependencies in sync")
          }),
        )
      })

      const which = Effect.fn("Npm.which")(function* (pkg: string) {
        const dir = directory(pkg)
        const binDir = path.join(dir, "node_modules", ".bin")

        const pick = Effect.fnUntraced(function* () {
          const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          if (files.length === 0) return undefined
          if (files.length === 1) return files[0]

          const pkgJson = yield* readPkg<Bin | undefined>(
            path.join(dir, "node_modules", pkg, "package.json"),
            undefined,
          )
          if (!pkgJson?.bin) return files[0]

          const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
          if (typeof pkgJson.bin === "string") return unscoped

          const keys = Object.keys(pkgJson.bin)
          if (keys.length === 1) return keys[0]
          return pkgJson.bin[unscoped] ? unscoped : keys[0]
        })

        const bin = yield* pick()
        if (bin) return path.join(binDir, bin)

        yield* fs.remove(path.join(dir, "package-lock.json")).pipe(Effect.catch(() => Effect.void))
        yield* add(pkg)
        const resolved = yield* pick()
        if (!resolved) return
        return path.join(binDir, resolved)
      })

      return Service.of({ add, install, outdated, which })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NpmConfig.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function add(pkg: string) {
    return runPromise((svc) => svc.add(pkg))
  }

  export async function install(dir: string) {
    return runPromise((svc) => svc.install(dir))
  }

  export async function outdated(pkg: string, cachedVersion: string) {
    return runPromise((svc) => svc.outdated(pkg, cachedVersion))
  }

  export async function which(pkg: string) {
    return runPromise((svc) => svc.which(pkg))
  }
}
