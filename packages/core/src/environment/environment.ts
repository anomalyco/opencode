import { Context, Effect, Schema } from "effect"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { PlatformPath } from "node:path"
import type { Driver } from "./driver.js"
import type { Files } from "./files.js"
import { makeFiles } from "./exec-defaults.js"
import { makeLocalDriver } from "./local.js"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"

// An environment's name: what a path will later use to say where it lives.
export const ID = Schema.String.pipe(Schema.brand("Environment.ID"))
export type ID = typeof ID.Type

/** The server's own machine. */
export const localID = ID.make("local")

/** Where a file or a directory is: an absolute path in an environment. */
export const Place = Schema.Struct({
  absolute: AbsolutePath,
  environment: Schema.Struct({ id: ID }),
})
export type Place = typeof Place.Type

/** What an environment says about itself, set by whoever makes it. Absent means no, or the server's own. */
export interface Facts {
  /** The path rules of its files, when they are not the server's. */
  readonly path?: PlatformPath
  /** The shell every command there runs under, when it is not the configured one. */
  readonly shell?: string
  /**
   * Whether this is the computer the server itself runs on, so a command there is the server's own child: it starts
   * from the server's variables, its cwd is made absolute here, the server's process daemon can hold it, and the
   * server's formatters reach its files.
   */
  readonly hostsServer?: boolean
  /** Whether a search can run over its files. It goes when the search tools no longer need a ripgrep binary there. */
  readonly searchable?: boolean
}

export interface Interface extends Facts {
  readonly id: ID
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

export const make = (id: ID, driver: Driver, facts?: Facts): Interface => ({
  ...facts,
  id,
  files: makeFiles(driver),
  spawner: driver.spawner,
})

/** The computer the server runs on. */
export const local = (spawner: ChildProcessSpawner["Service"]) =>
  make(localID, makeLocalDriver(spawner), { hostsServer: true, searchable: true })

/** The place of a path or a command that names no directory: the Location's directory, in its environment. */
export const workingDirectory = Effect.gen(function* () {
  const location = yield* Location.Service
  const environment = yield* Service
  return { absolute: location.directory, environment }
})

export * as EnvironmentService from "./environment.js"
