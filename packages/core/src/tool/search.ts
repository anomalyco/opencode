export * as ToolSearch from "./search.js"

import { ToolFailure } from "@opencode/ai/effect"
import { Effect } from "effect"
import { Environment } from "../environment/index.js"
import { FileSystem } from "../filesystem.js"

export const pathType = (files: Environment.Files, absolute: string, display: string) =>
  Environment.typeFollowing(files, absolute).pipe(
    Effect.catchTag("Environment.NotFound", () =>
      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${display}` })),
    ),
  )

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
