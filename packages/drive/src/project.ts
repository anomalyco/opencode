import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

/** OpenCode's semantic project configuration, written to opencode.jsonc. */
export interface OpenCodeConfig extends JsonObject {}

/** OpenCode's semantic TUI configuration, written to tui.jsonc. */
export interface OpenCodeTuiConfig extends JsonObject {}

export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()(
  "FileSystemError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export interface ProjectFileSystem {
  /** Writes inside the isolated project and creates parent directories. */
  writeFile(
    path: string,
    contents: string | Uint8Array,
  ): Effect.Effect<void, FileSystemError>
}

export interface SetupContext {
  readonly fs: ProjectFileSystem
  /** The current OpenCode config object. Mutate it to customize the run. */
  readonly config: OpenCodeConfig
  /** The current OpenCode TUI config object. Mutate it to customize the run. */
  readonly tuiConfig: OpenCodeTuiConfig
}

export interface Project {
  /** Files written into the isolated project before setup runs. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  /** Initializes the project as a Git repository and commits its pre-launch state. */
  readonly git?: boolean
}

export type Setup = (
  context: SetupContext,
) => Effect.Effect<void, unknown>
