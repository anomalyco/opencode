export * as ToolSearch from "./search.js"

import { ToolFailure } from "@opencode/ai/effect"
import { Effect } from "effect"
import { Environment } from "../environment/index.js"
import type { FileAccess } from "../file-access.js"
import { FileSystem } from "../filesystem.js"

/** Refuses a search where none can run yet: it needs a ripgrep binary the environment's spawner can start. */
export const available = (environment: Environment.Interface) =>
  environment.searchable
    ? Effect.void
    : Effect.fail(new ToolFailure({ message: `Search is not available on ${environment.id} yet.` }))

export const pathType = (files: Environment.Files, absolute: string, display: string) =>
  Environment.typeFollowing(files, absolute).pipe(
    Effect.catchTag("Environment.NotFound", () =>
      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${display}` })),
    ),
  )

/** Try a remote working directory directly; on failure retain the usual path validation. */
export const withPathType = <A, E, R>(
  target: FileAccess.Target,
  display: string,
  directory: string,
  search: (type: Environment.FileType) => Effect.Effect<A, E, R>,
) => {
  const type = pathType(target.environment.files, target.absolute, display)
  // Local spawners can throw synchronously for a non-directory cwd, so retain their preflight check.
  if (target.environment.hostsServer || target.machine || target.absolute !== directory)
    return type.pipe(Effect.flatMap(search))
  return search("directory").pipe(
    Effect.catch((error) =>
      type.pipe(Effect.flatMap((type) => (type === "directory" ? Effect.fail(error) : search(type)))),
    ),
  )
}

// Fetches one result past the limit so truncation can be reported without a second search.
export const bounded = <A, E, R>(limit: number, search: (limit: number) => Effect.Effect<readonly A[], E, R>) =>
  search(limit + 1).pipe(
    Effect.timeoutOrElse({
      duration: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new ToolFailure({
            message: `Search timed out after ${FileSystem.DEFAULT_SEARCH_TIMEOUT_MS / 1_000} seconds. Consider using a more specific path or pattern.`,
          }),
        ),
    }),
    Effect.map((items) => ({ items: items.slice(0, limit), truncated: items.length > limit })),
  )
