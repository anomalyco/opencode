export * as SshCache from "./ssh-cache"

import path from "path"
import { createHash } from "crypto"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "./process"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { EffectFlock } from "./util/effect-flock"

export type Result = {
  readonly host: string
  readonly remotePath: string
  readonly localPath: string
  readonly status: "synced" | "cached"
}

export type EnsureInput = {
  readonly host: string
  readonly remotePath: string
  readonly user?: string
  readonly port?: number
  readonly identityFile?: string
  readonly refresh?: boolean
}

export function computeCachePath(root: string, host: string, remotePath: string, user?: string) {
  const key = `${host}:${remotePath}:${user ?? ""}`
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16)
  return path.join(root, hash)
}

export class SshInvalidTargetError extends Schema.TaggedErrorClass<SshInvalidTargetError>()(
  "SshCacheInvalidTargetError",
  {
    host: Schema.String,
    remotePath: Schema.String,
    message: Schema.String,
  },
) {}

export class SshRsyncFailedError extends Schema.TaggedErrorClass<SshRsyncFailedError>()(
  "SshCacheRsyncFailedError",
  {
    host: Schema.String,
    remotePath: Schema.String,
    message: Schema.String,
  },
) {}

export class SshLockFailedError extends Schema.TaggedErrorClass<SshLockFailedError>()(
  "SshCacheLockFailedError",
  {
    localPath: Schema.String,
    message: Schema.String,
  },
) {}

export class SshCacheOperationError extends Schema.TaggedErrorClass<SshCacheOperationError>()(
  "SshCacheOperationError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type Error =
  | SshInvalidTargetError
  | SshRsyncFailedError
  | SshLockFailedError
  | SshCacheOperationError

export interface Interface {
  readonly ensure: (input: EnsureInput) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SshCache") {}

export const layer: Layer.Layer<Service, never, AppProcess.Service | FSUtil.Service | EffectFlock.Service | Global.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const proc = yield* AppProcess.Service
      const flock = yield* EffectFlock.Service
      const global = yield* Global.Service

      return Service.of({
        ensure: Effect.fn("SshCache.ensure")(function* (input) {
          if (!input.host || input.host.includes(":") || input.host.includes("/") || input.host.startsWith("-")) {
            return yield* new SshInvalidTargetError({
              host: input.host,
              remotePath: input.remotePath,
              message: `Invalid SSH host: ${input.host}`,
            })
          }
          if (!input.remotePath || !input.remotePath.startsWith("/")) {
            return yield* new SshInvalidTargetError({
              host: input.host,
              remotePath: input.remotePath,
              message: `remotePath must be an absolute path, got: ${input.remotePath}`,
            })
          }
          const localPath = computeCachePath(global.sshCache, input.host, input.remotePath, input.user)

          return yield* flock
            .withLock(
              Effect.gen(function* () {
                yield* cacheOperation(fs.ensureDir(path.dirname(localPath)), "ensure cache directory", localPath)

                const exists = yield* fs.existsSafe(localPath)
                if (exists && !input.refresh) {
                  return {
                    host: input.host,
                    remotePath: input.remotePath,
                    localPath,
                    status: "cached" as const,
                  }
                }

                if (!exists) {
                  yield* cacheOperation(fs.ensureDir(localPath), "create local cache dir", localPath)
                }

                const userPart = input.user ? `${input.user}@` : ""
                const remote = `${userPart}${input.host}:${input.remotePath}/`
                const sshCmd = ["ssh"]
                if (input.port) sshCmd.push("-p", String(input.port))
                if (input.identityFile) sshCmd.push("-i", input.identityFile)
                sshCmd.push("-o", "StrictHostKeyChecking=accept-new")

                const result = yield* proc
                  .run(
                    ChildProcess.make("rsync", [
                      "-az",
                      "--delete",
                      "-e",
                      sshCmd.join(" "),
                      remote,
                      localPath + "/",
                    ]),
                    { timeout: Duration.minutes(5) },
                  )
                  .pipe(
                    Effect.mapError((error) => new SshRsyncFailedError({
                      host: input.host,
                      remotePath: input.remotePath,
                      message: error.stderr ?? error.message,
                    })),
                  )

                if (result.exitCode !== 0) {
                  return yield* new SshRsyncFailedError({
                    host: input.host,
                    remotePath: input.remotePath,
                    message: result.stderr.toString("utf8").trim() || `rsync failed with exit code ${result.exitCode}`,
                  })
                }

                return {
                  host: input.host,
                  remotePath: input.remotePath,
                  localPath,
                  status: "synced" as const,
                }
              }),
              `ssh-cache:${localPath}`,
            )
            .pipe(
              Effect.mapError((error) =>
                isError(error) ? error : new SshLockFailedError({ localPath, message: errorMessage(error) }),
              ),
            )
        }),
      })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(Global.defaultLayer),
)

export function isError(error: unknown): error is Error {
  return (
    error instanceof SshInvalidTargetError ||
    error instanceof SshRsyncFailedError ||
    error instanceof SshLockFailedError ||
    error instanceof SshCacheOperationError
  )
}

function errorMessage(error: unknown) {
  return error instanceof globalThis.Error ? error.message : String(error)
}

function cacheOperation<A, E, R>(effect: Effect.Effect<A, E, R>, operation: string, target: string) {
  return effect.pipe(
    Effect.mapError((error) => new SshCacheOperationError({ operation, path: target, message: errorMessage(error) })),
  )
}
