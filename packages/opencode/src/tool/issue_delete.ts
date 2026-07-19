import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_delete.txt"
import { Issue } from "../issue/issue"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier of the issue to delete" }),
})

type Metadata = {
  deleted: boolean
  remainingCount: number
}

/**
 * Discriminated union for the delete outcome (TypeScript best practice for
 * result-or-error types, per ADR-0002 Amendment 2026-07-19). Replaces the
 * previous inverted `archived: boolean` flag whose semantics were unclear:
 * `archived: false` was returned on successful deletion (the issue is gone,
 * hence "not archived") and `archived: true` was returned when the issue was
 * NOT archived (i.e. active) and rejection occurred — the flag tracked the
 * pre-call state but read as the post-call state.
 *
 * Per the user's semantic clarification (2026-07-19): "archive" = move to
 * recycle bin; "delete" = permanently remove from the recycle bin. Only
 * archived issues can be deleted. The discriminated union makes the two
 * outcomes explicit and self-documenting, eliminating the naming hazard.
 *
 * References:
 * - TypeScript Discriminated Unions handbook
 * - Effect's `Effect.catchTag` pattern (tagged errors → tagged outcomes)
 * - Rust `Result<T, E>` algebraic data type pattern
 */
type DeleteOutcome =
  | { ok: true; remainingCount: number }
  | { ok: false; reason: "not_archived" }
  | { ok: false; reason: "not_found" }

/** Delete a single workspace-scoped issue by id. Only archived issues can be deleted. */
export const IssueDeleteTool = Tool.define(
  "issue_delete",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const outcome = yield* issue.delete({ directory, id: params.id }).pipe(
            Effect.map((): DeleteOutcome => {
              // Successful deletion — the issue was archived and is now
              // permanently removed. We need the remaining count for the
              // agent-facing summary, fetched below.
              return { ok: true, remainingCount: 0 }
            }),
            Effect.catchTag("Issue.NotArchivedError", (): Effect.Effect<DeleteOutcome> =>
              Effect.succeed({ ok: false, reason: "not_archived" }),
            ),
            Effect.catchTag("Issue.NotFoundError", (): Effect.Effect<DeleteOutcome> =>
              Effect.succeed({ ok: false, reason: "not_found" }),
            ),
          )

          if (!outcome.ok) {
            if (outcome.reason === "not_found") {
              return {
                title: `issue_delete: ${params.id} not found`,
                output: JSON.stringify(
                  { deleted: false, error: `Issue not found: ${params.id}` },
                  null,
                  2,
                ),
                metadata: { deleted: false, remainingCount: 0 } as Metadata,
              }
            }
            return {
              title: `issue_delete: ${params.id} not archived`,
              output: JSON.stringify(
                {
                  deleted: false,
                  error: 'Issue is Active — archive it first with issue_archive({ id, outcome: "done" })',
                },
                null,
                2,
              ),
              metadata: { deleted: false, remainingCount: 0 } as Metadata,
            }
          }

          const remaining = yield* issue.get({ directory })

          return {
            title: `issue_delete: ${params.id}`,
            output: JSON.stringify({ deleted: true, remainingCount: remaining.length }, null, 2),
            metadata: { deleted: true, remainingCount: remaining.length } as Metadata,
          }
        }),
    }
  }),
)
