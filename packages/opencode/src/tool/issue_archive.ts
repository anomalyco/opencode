import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_archive.txt"
import { Issue } from "../issue/issue"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique identifier of the issue to archive" }),
  outcome: Schema.Literals(["done", "canceled", "duplicate"]).annotate({
    description:
      'Terminal outcome: "done" (completed), "canceled" (abandoned), "duplicate" (already tracked elsewhere)',
  }),
})

type Metadata = {
  issue?: Issue.Info
  archived: boolean
}

/**
 * Discriminated union for the archive outcome, mirroring `issue_delete.ts`.
 * `Tool.define` requires the execute Effect to have error channel `never`,
 * so `IssueNotFoundError` is caught via `Effect.catchTag` and folded into
 * this union. Defects (Interrupt/Die) propagate naturally.
 */
type ArchiveOutcome =
  | { ok: true; issue: Issue.Info }
  | { ok: false; reason: "not_found"; detail: string }

/** Archive a single workspace-scoped issue by id with a terminal outcome. */
export const IssueArchiveTool = Tool.define(
  "issue_archive",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const outcome = yield* issue
            .archive({
              directory,
              id: params.id,
              outcome: params.outcome,
            })
            .pipe(
              Effect.map((archived): ArchiveOutcome => ({ ok: true, issue: archived })),
              Effect.catchTag("Issue.NotFoundError", (e) =>
                Effect.succeed<ArchiveOutcome>({
                  ok: false,
                  reason: "not_found",
                  detail: e.context ?? e.id,
                }),
              ),
            )

          if (!outcome.ok) {
            return {
              title: `issue_archive: ${params.id} failed (${outcome.reason})`,
              output: JSON.stringify(
                { archived: false, error: outcome.detail, reason: outcome.reason },
                null,
                2,
              ),
              metadata: { archived: false } as Metadata,
            }
          }

          return {
            title: `issue_archive: ${outcome.issue.title} (${params.outcome})`,
            output: JSON.stringify(outcome.issue, null, 2),
            metadata: { issue: outcome.issue, archived: true } satisfies Metadata,
          }
        }),
    }
  }),
)
