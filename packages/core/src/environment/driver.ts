export * as EnvironmentDriver from "./driver.js"

import { Effect, PlatformError, Scope } from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { Options } from "./environment.js"
import { makeFiles } from "./exec-defaults.js"
import { Failed, type Files, type FilesImpl } from "./files.js"

export type DriverOptions = Omit<Options, "local">

/**
 * Execution and file primitives supplied by an environment backend.
 *
 * `spawner` runs processes in the target environment. `overrides` lets backends with a native file channel
 * (such as the local host or a connected worker) handle file operations directly instead of shelling out through
 * `spawner`. `options` lets the driver declare target defaults such as `path`, `shell`, `home`, or `rg`.
 */
export interface Driver {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly overrides?: Partial<FilesImpl>
  readonly options?: DriverOptions
}

export interface LazyOptions {
  readonly module: string
  readonly spawnDescription: string
  readonly options?: DriverOptions
}

/**
 * Builds a `Driver` that acquires a scoped backend on each file or spawn operation and maps acquire failures into
 * `Environment.Failed` (files) or `PlatformError` (spawn). Keeps callers (workspaces, pull-mode workers, unavailable
 * stubs) from repeating the same 8-method file wrapper.
 */
export const lazy = (acquire: Effect.Effect<Driver, unknown, Scope.Scope>, config: LazyOptions): Driver => {
  const spawner = ChildProcessSpawner.make((command) =>
    acquire.pipe(
      Effect.mapError((cause) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: config.module,
          method: "spawn",
          description: config.spawnDescription,
          cause,
        }),
      ),
      Effect.flatMap((driver) => driver.spawner.spawn(command)),
    ),
  )
  const withFiles = <A, E>(path: string, use: (files: Files) => Effect.Effect<A, E>): Effect.Effect<A, E | Failed> =>
    Effect.scoped(
      acquire.pipe(
        Effect.mapError((cause) => new Failed({ path, cause })),
        Effect.flatMap((driver) => use(makeFiles(driver))),
      ),
    )
  const overrides: FilesImpl = {
    read: (path, range) => withFiles(path, (files) => files.read(path, range)),
    write: (path, bytes) => withFiles(path, (files) => files.write(path, bytes)),
    stat: (path) => withFiles(path, (files) => files.stat(path)),
    list: (path) => withFiles(path, (files) => files.list(path)),
    remove: (path) => withFiles(path, (files) => files.remove(path)),
    move: (from, to) => withFiles(from, (files) => files.move(from, to)),
    mkdir: (path) => withFiles(path, (files) => files.mkdir(path)),
    append: (path, bytes) => withFiles(path, (files) => files.append(path, bytes)),
  }
  return { spawner, overrides, options: config.options }
}
