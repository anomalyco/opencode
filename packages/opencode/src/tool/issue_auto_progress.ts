import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./issue_auto_progress.txt"
import { AutoProgress } from "../issue/auto-progress"
import { context } from "@/project/instance-context"

const Parameters = Schema.Struct({
  action: Schema.Literals(["start", "stop", "status"]).annotate({
    description:
      "Action to perform: start (begin auto-advancing issues), stop (halt the engine), status (check if running)",
  }),
})

type Metadata = {
  action: string
  status: string
}

/** Start, stop, or check the workspace-scoped auto-progress engine */
export const IssueAutoProgressTool = Tool.define(
  "issue_auto_progress",
  Effect.gen(function* () {
    const ap = yield* AutoProgress.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const directory = context.use().directory

          if (params.action === "start") {
            yield* ap.start(directory)
            const status = yield* ap.status(directory)
            return {
              title: `issue_auto_progress: started (${status})`,
              output: JSON.stringify({ action: "start", status }, null, 2),
              metadata: { action: "start", status } satisfies Metadata,
            }
          }

          if (params.action === "stop") {
            yield* ap.stop(directory)
            const status = yield* ap.status(directory)
            return {
              title: `issue_auto_progress: stopped (${status})`,
              output: JSON.stringify({ action: "stop", status }, null, 2),
              metadata: { action: "stop", status } satisfies Metadata,
            }
          }

          const status = yield* ap.status(directory)
          return {
            title: `issue_auto_progress: ${status}`,
            output: JSON.stringify({ action: "status", status }, null, 2),
            metadata: { action: "status", status } satisfies Metadata,
          }
        }),
    }
  }),
)
