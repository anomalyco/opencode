import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { FilesImpl } from "./files"

export interface Driver {
  readonly spawner: ChildProcessSpawner["Service"]
  readonly overrides?: Partial<FilesImpl>
}

export * as EnvironmentDriver from "./driver"
