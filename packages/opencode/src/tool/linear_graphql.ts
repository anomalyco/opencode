import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./linear_graphql.txt"
import { LinearGraphqlClient } from "@/issue/linear-graphql"

const Parameters = Schema.Struct({
  mutation: Schema.String.annotate({
    description:
      "GraphQL operation body. Example: `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id dueDate } } }`",
  }),
  variables: Schema.Record(Schema.String, Schema.Unknown).annotate({
    description:
      'JSON object of variables referenced in the mutation. Example: `{ "id": "LIN-123", "input": { "dueDate": null } }`',
  }),
})

type Metadata = {
  ok: boolean
}

/**
 * Discriminated union for the call outcome. `Tool.define` requires the
 * execute Effect to have error channel `never`, so `LinearMcpError` is
 * caught via `Effect.catchTag` and folded into this union. Defects
 * (Interrupt/Die) propagate naturally — only the expected Linear failure
 * type is converted to a soft error the Agent can read.
 */
type CallOutcome = { ok: true; data: unknown } | { ok: false; error: string }

/**
 * Linear GraphQL escape hatch for the Agent (ADR-0005 D4).
 *
 * Exposes the Linear GraphQL API directly so the Agent can perform
 * operations that the Linear MCP server's `save_issue` tool cannot
 * express — primarily clearing fields by setting them to `null`
 * (dueDate, description) and deleting issues (no `delete_issue` MCP tool).
 *
 * The shared `LinearGraphqlClient.Service` is the same one used by the
 * user-side sync path (`sync-push.ts` clearDueDateViaGraphQL), so the
 * two paths share a single source of truth for "how to talk to Linear
 * GraphQL" (auth header format, URL, error handling).
 */
export const LinearGraphqlTool = Tool.define(
  "linear_graphql",
  Effect.gen(function* () {
    const graphql = yield* LinearGraphqlClient.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const outcome = yield* graphql.call(params.mutation, params.variables).pipe(
            Effect.map((data): CallOutcome => ({ ok: true, data })),
            Effect.catchTag("LinearMcpError", (e) => Effect.succeed<CallOutcome>({ ok: false, error: e.message })),
          )

          if (!outcome.ok) {
            return {
              title: `linear_graphql: failed`,
              output: JSON.stringify({ ok: false, error: outcome.error }, null, 2),
              metadata: { ok: false } as Metadata,
            }
          }

          return {
            title: `linear_graphql: ok`,
            output: JSON.stringify({ ok: true, data: outcome.data }, null, 2),
            metadata: { ok: true } as Metadata,
          }
        }),
    }
  }),
)
