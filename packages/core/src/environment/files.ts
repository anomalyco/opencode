import type { FilesImpl } from "@opencode/plugin/effect/environment-files"
import { Effect } from "effect"

export {
  type DirEntry,
  Failed,
  type FileInfo,
  type FilesImpl,
  FileType,
  NotFound,
  WrongKind,
} from "@opencode/plugin/effect/environment-files"

export interface Files extends FilesImpl {}

/**
 * Derives a follow-stat kind from the lstat-like Files contract. A dangling
 * symlink fails with `NotFound`.
 */
export const typeFollowing = (files: Files, path: string) =>
  files.stat(path).pipe(
    Effect.flatMap((info) =>
      info.type === "symlink"
        ? files.read(path, { offset: 0, length: 0 }).pipe(
            Effect.map((result) => result.info.type),
            Effect.catchTag("Environment.WrongKind", (error) => Effect.succeed(error.actual)),
          )
        : Effect.succeed(info.type),
    ),
  )

/** Follows a final symlink, so a dangling symlink does not exist. */
export const exists = (files: Files, path: string) =>
  typeFollowing(files, path).pipe(
    Effect.as(true),
    Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
  )

export * as EnvironmentFiles from "./files.js"
