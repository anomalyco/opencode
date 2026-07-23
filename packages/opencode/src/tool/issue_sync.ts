import { Effect, Schema, Exit } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_sync.txt"
import { SyncPull } from "@/issue/sync-pull"
import { SyncPush } from "@/issue/sync-push"
import { LinearClientRef, LinearMcpClient } from "@/issue/mcp-client"
import { LinearGraphqlClient } from "@/issue/linear-graphql"
import { Issue } from "@/issue/issue"
import { LinearBinding } from "@/issue/linear-binding"
import { Database } from "@opencode-ai/core/database/database"
import { MCP } from "@/mcp"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  direction: Schema.optional(Schema.Literals(["pull", "push"])).annotate({
    description:
      'Sync direction: "pull" (default) fetches Linear state into local; "push" sends local-only issues to Linear',
  }),
})

type Metadata = {
  ok: boolean
  direction: "pull" | "push"
}

/**
 * Discriminated union for the sync outcome. `Tool.define` requires the
 * execute Effect to have error channel `never`, so `SyncPullError` /
 * `SyncPushError` are caught via `Effect.catchTag` and folded into this
 * union. Defects (Interrupt/Die) propagate naturally.
 */
type SyncOutcome =
  | { ok: true; direction: "pull" | "push"; summary: unknown }
  | { ok: false; direction: "pull" | "push"; error: string }

/**
 * `issue_sync` agent tool (ADR-0005 D3).
 *
 * Triggers `SyncPull.pull` or `SyncPush.push` from the agent path. Used
 * after the agent edits Linear via MCP/GraphQL (pull reconciles local),
 * or after local creates that should appear on Linear (push sends them).
 *
 * The tool is a thin wrapper: it resolves a Linear client, provides it
 * to the sync service as `LinearClientRef` (the same context tag the
 * HTTP path consumes via `LinearClientMiddleware`), calls the sync
 * function, and returns the summary. All sync logic (shadow diff,
 * field-level merge, orphan detection) lives in the sync services.
 *
 * All Service requirements (`MCP.Service`, `LinearBinding.Service`,
 * `Issue.Service`, `Database.Service`, `LinearGraphqlClient.Service`)
 * are yielded in the outer `Effect.gen` closure so the `execute`
 * function has a `never` requirement context, matching `Tool.define`'s
 * contract. They are then provided to the sync calls via
 * `Effect.provideService` so the inner sync functions find them in
 * their own context.
 */
export const IssueSyncTool = Tool.define(
  "issue_sync",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const binding = yield* LinearBinding.Service
    const issue = yield* Issue.Service
    const database = yield* Database.Service
    const db = database.db
    const graphql = yield* LinearGraphqlClient.Service

    const resolveLinearClient = Effect.fn("IssueSync.resolveLinearClient")(function* () {
      const clients = yield* mcp.clients()
      const raw = clients["linear"]
      if (raw) return LinearMcpClient.wrap(raw)

      // Env-var fallback. After one failure (missing env var or connection
      // error), `LinearMcpClient.create()` is retried on each call — the
      // agent tool path is less hot than the HTTP handler, so we skip the
      // sticky "failed" flag the HTTP handler uses.
      const exit = yield* LinearMcpClient.create().pipe(Effect.exit)
      if (Exit.isFailure(exit)) return undefined
      return exit.value
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const direction = params.direction ?? "pull"
          const directory = yield* InstanceState.directory
          const client = yield* resolveLinearClient()

          if (!client) {
            return {
              title: `issue_sync: ${direction} failed (no Linear client)`,
              output: JSON.stringify(
                {
                  ok: false,
                  direction,
                  error:
                    "Linear client not available. Register the Linear MCP server in opencode.jsonc or set LINEAR_API_KEY.",
                },
                null,
                2,
              ),
              metadata: { ok: false, direction } as Metadata,
            }
          }

          // Provide every Service the sync functions need so the inner
          // Effect's requirement channel stays `never` from the tool's
          // perspective. `LinearClientRef` carries the LinearMcpClient
          // instance resolved above — the same context tag the HTTP path
          // consumes via `LinearClientMiddleware`.
          const outcome: SyncOutcome =
            direction === "pull"
              ? yield* SyncPull.pull({ directory }).pipe(
                  Effect.provideService(LinearClientRef, client),
                  Effect.provideService(LinearBinding.Service, binding),
                  Effect.provideService(Issue.Service, issue),
                  Effect.provideService(Database.Service, { db }),
                  Effect.provideService(LinearGraphqlClient.Service, graphql),
                  Effect.map((result): SyncOutcome => ({ ok: true, direction, summary: result })),
                  Effect.catchTag("SyncPullError", (e) =>
                    Effect.succeed<SyncOutcome>({
                      ok: false,
                      direction,
                      error: e.message,
                    }),
                  ),
                )
              : yield* SyncPush.push({ directory, issueIds: [] }).pipe(
                  Effect.provideService(LinearClientRef, client),
                  Effect.provideService(LinearBinding.Service, binding),
                  Effect.provideService(Issue.Service, issue),
                  Effect.provideService(Database.Service, { db }),
                  Effect.provideService(LinearGraphqlClient.Service, graphql),
                  Effect.map((result): SyncOutcome => ({ ok: true, direction, summary: result })),
                  Effect.catchTag("SyncPushError", (e) =>
                    Effect.succeed<SyncOutcome>({
                      ok: false,
                      direction,
                      error: e.message,
                    }),
                  ),
                )

          if (!outcome.ok) {
            return {
              title: `issue_sync: ${direction} failed`,
              output: JSON.stringify(outcome, null, 2),
              metadata: { ok: false, direction } as Metadata,
            }
          }

          return {
            title: `issue_sync: ${direction} ok`,
            output: JSON.stringify(outcome, null, 2),
            metadata: { ok: true, direction } as Metadata,
          }
        }),
    }
  }),
)
