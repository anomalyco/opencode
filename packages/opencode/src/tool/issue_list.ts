import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_list.txt"
import { Issue } from "../issue/issue"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  include_archived: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, return all issues (including Archived). When false or omitted, return only Active L1 and their Active L2; archived L1 hides its entire subtree. Defaults to false.",
  }),
})

type Metadata = {
  count: number
  include_archived: boolean
}

/**
 * List workspace-scoped issues (todos) in the current project directory.
 * Returns a flat array; reconstruct L1→L2 hierarchy via `parent_id` + `level`.
 */
export const IssueListTool = Tool.define(
  "issue_list",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const includeArchived = params.include_archived ?? false
          const issues = yield* issue.get({ directory, include_archived: includeArchived })

          // ADR-0005 D6: strip sync-internal bookkeeping fields before
          // exposing to the agent. `linear_*` fields stay (routing).
          const agentIssues = issues.map(Issue.toAgentInfo)

          return {
            title: `issue_list: ${agentIssues.length} issue${agentIssues.length === 1 ? "" : "s"}`,
            output: JSON.stringify(agentIssues, null, 2),
            metadata: { count: agentIssues.length, include_archived: includeArchived } satisfies Metadata,
          }
        }),
    }
  }),
)
