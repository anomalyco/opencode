import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import path from "node:path"
import { type Driver, type DriverOptions, EnvironmentDriver } from "./driver.js"
import type { Files } from "./files.js"
import { makeFiles } from "./exec-defaults.js"
import { makeLocalDriver } from "./local.js"
import { EnvironmentUnavailable } from "./unavailable.js"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import type { Workspace } from "@opencode/schema/workspace"
import { WorkspaceConnector } from "./workspace-connector.js"

// An environment's name: what a path will later use to say where it lives.
export const ID = Schema.String.pipe(Schema.brand("Environment.ID"))
export type ID = typeof ID.Type

/**
 * The server's own Location/environment name. Unlike `environment.local`, this still matches on runtimes without a
 * local host OS (such as workerd) so bare server Locations remain distinct from sandboxed workspace Locations.
 */
export const localID = ID.make("local")

/** Where a file or a directory is: an absolute path in an environment. */
export const Place = Schema.Struct({
  absolute: AbsolutePath,
  environment: Schema.Struct({ id: ID }),
})
export type Place = typeof Place.Type

/** Target properties supplied by whoever constructs an Environment. */
export interface Options {
  /**
   * True only when commands and files live on the server's own OS process (false on workerd and all remotes):
   * commands start from the server's variables, cwds resolve here, the process daemon can hold them, and host
   * formatters and worktree strategies reach its files.
   */
  readonly local?: boolean
  /** The path rules of its files, when they are not the server's. */
  readonly path?: path.PlatformPath
  /** The shell every command there runs under, when it is not the configured one. */
  readonly shell?: string
  /** Resolves `~` in this environment when available (host homedir locally, `hello.home` on paired machines). */
  readonly home?: Effect.Effect<string | undefined, unknown>
  /**
   * Ripgrep command to spawn in this environment (`undefined` means search is unavailable).
   * Local environments (`local: true`) use the bundled `RipgrepBinary` when `rg` is set.
   */
  readonly rg?: Effect.Effect<string, unknown>
}

export interface Interface {
  readonly id: ID
  /** True only when commands and files live on the server's own OS process (false on workerd and all remotes). */
  readonly local: boolean
  /** The path rules of its files (host `node:path` locally, POSIX on remotes and workspaces). */
  readonly path: path.PlatformPath
  /** The shell every command there runs under, when it is not the configured one. */
  readonly shell?: string
  /** Resolves `~` in this environment when available (host homedir locally, `hello.home` on paired machines). */
  readonly home?: Effect.Effect<string | undefined, unknown>
  /**
   * Ripgrep command to spawn in this environment (`undefined` means search is unavailable).
   * Local environments (`local: true`) use the bundled `RipgrepBinary` when `rg` is set.
   */
  readonly rg?: Effect.Effect<string, unknown>
  readonly files: Files
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

const pickOption = <K extends keyof DriverOptions>(
  driver: Driver,
  options: Options | undefined,
  key: K,
): DriverOptions[K] => (options !== undefined && key in options ? options[key] : driver.options?.[key])

export const make = (id: ID, driver: Driver, options?: Options): Interface => ({
  id,
  // `local` is owned exclusively by the explicit `options` argument so a remote driver can never claim host privileges.
  local: options?.local === true,
  path: options?.path ?? driver.options?.path ?? path,
  shell: pickOption(driver, options, "shell"),
  home: pickOption(driver, options, "home"),
  rg: pickOption(driver, options, "rg"),
  files: makeFiles(driver),
  spawner: driver.spawner,
})

/**
 * The computer the server runs on. Runtimes without local execution (such as workerd) have neither local
 * process spawning nor a local host filesystem, so they fall back to the unavailable spawner without node:fs.
 */
export const local = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  spawner === EnvironmentUnavailable.spawner
    ? make(localID, { spawner }, { path: path.posix })
    : make(localID, makeLocalDriver(spawner), {
        local: true,
        home: Effect.sync(() => Global.Path.home),
        rg: Effect.succeed("rg"),
      })

/** A workspace sandbox environment; runs ripgrep through its own spawner and uses POSIX path rules and `sh`. */
export const workspace = (id: Workspace.ID, driver: Driver) =>
  make(ID.make(id), driver, {
    path: driver.options?.path ?? path.posix,
    shell: driver.options !== undefined && "shell" in driver.options ? driver.options.shell : "sh",
    rg: driver.options !== undefined && "rg" in driver.options ? driver.options.rg : Effect.succeed("rg"),
    local: false,
  })

/**
 * A total environment handle that fails every file and command operation loudly with `cause` instead of
 * silently falling back to the server host.
 */
export const unavailable = (id: ID, cause: Error): Interface =>
  make(
    id,
    EnvironmentDriver.lazy(Effect.fail(cause), {
      module: "Environment",
      spawnDescription: cause.message,
    }),
    { path: path.posix, shell: "sh" },
  )

/**
 * A session's own working directory, bound to its environment, provided by the runner around a step.
 * Absent unless the session sets one, so bare paths and commands stay on the Location's directory.
 */
export const CurrentWorkingDirectory = Context.Reference<
  { readonly absolute: AbsolutePath; readonly environment: Interface } | undefined
>("@opencode/Environment/CurrentWorkingDirectory", { defaultValue: () => undefined })

/** Build once inside a Location layer; resolves CurrentWorkingDirectory per call, falling back to the Location's default. */
export const workingDirectoryResolver = Effect.gen(function* () {
  const location = yield* Location.Service
  const environment = yield* Service
  const fallback = { absolute: location.directory, environment }
  return Effect.map(CurrentWorkingDirectory, (cwd) => cwd ?? fallback)
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const location = yield* Location.Service
    const connector = yield* WorkspaceConnector.Service
    if (!location.workspaceID) return Service.of(local(spawner))
    // An unknown or destroyed placement surfaces on each operation, not here.
    return Service.of(workspace(location.workspaceID, yield* connector.connect(location.workspaceID)))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, WorkspaceConnector.node],
})

export * as EnvironmentService from "./environment.js"
