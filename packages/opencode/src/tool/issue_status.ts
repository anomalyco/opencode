import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_status.txt"
import { Issue } from "../issue/issue"
import { Instance } from "../project/instance"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the issue"),
  status: Issue.Status.describe("New status: backlog, todo, in_progress, in_review, done, canceled"),
})

type Metadata = {
  issue: Issue.Info
  from: Issue.Status | null
  to: Issue.Status
}

/** Change the status of a workspace-scoped issue */
export const IssueStatusTool = Tool.define<typeof parameters, Metadata, Issue.Service>(
  "issue_status",
  Effect.gen(function* () {
    const issue = yield* Issue.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = Instance.directory
          const before = (yield* issue.get({ directory })).find((i) => i.id === params.id)
          const updated = yield* issue.patchStatus({ directory, id: params.id, status: params.status })

          return {
            title: `issue_status: ${updated.title} → ${updated.status}`,
            output: JSON.stringify(updated, null, 2),
            metadata: { issue: updated, from: before?.status ?? null, to: updated.status },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
