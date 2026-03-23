import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, FileSystem, ServiceMap } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function clean(dir: string) {
  return fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

async function stop(dir: string) {
  if (!(await exists(dir))) return
  await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    await $`git init`.cwd(dirpath).quiet()
    await $`git config core.fsmonitor false`.cwd(dirpath).quiet()
    await $`git config user.email "test@opencode.test"`.cwd(dirpath).quiet()
    await $`git config user.name "Test"`.cwd(dirpath).quiet()
    await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet()
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        ...options.config,
      }),
    )
  }
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const extra = await options?.init?.(realpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(realpath)
      } finally {
        if (options?.git) await stop(realpath).catch(() => undefined)
        await clean(realpath).catch(() => undefined)
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}

/** Effectful scoped tmpdir. Cleaned up when the scope closes. Make sure these stay in sync */
export function tmpdirScoped(options?: { git?: boolean; config?: Partial<Config.Info> }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-test-" })

    const git = (...args: string[]) =>
      spawner.spawn(ChildProcess.make("git", args, { cwd: dir })).pipe(Effect.flatMap((handle) => handle.exitCode))

    if (options?.git) {
      yield* git("init")
      yield* git("config", "core.fsmonitor", "false")
      yield* git("config", "user.email", "test@opencode.test")
      yield* git("config", "user.name", "Test")
      yield* git("commit", "--allow-empty", "-m", "root commit")
    }

    if (options?.config) {
      yield* fs.writeFileString(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", ...options.config }),
      )
    }

    return dir
  })
}

export const provideInstance =
  (directory: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.servicesWith((services: ServiceMap.ServiceMap<R>) =>
      Effect.promise<A>(async () =>
        Instance.provide({
          directory,
          fn: () => Effect.runPromiseWith(services)(self),
        }),
      ),
    )

export function provideTmpdirInstance<A, E, R>(
  self: (path: string) => Effect.Effect<A, E, R>,
  options?: { git?: boolean; config?: Partial<Config.Info> },
) {
  return Effect.gen(function* () {
    const path = yield* tmpdirScoped(options)
    let provided = false

    yield* Effect.addFinalizer(() =>
      provided
        ? Effect.promise(() =>
            Instance.provide({
              directory: path,
              fn: () => Instance.dispose(),
            }),
          ).pipe(Effect.ignore)
        : Effect.void,
    )

    provided = true
    return yield* self(path).pipe(provideInstance(path))
  })
}
