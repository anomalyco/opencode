import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./auto_progress.txt"
import { AutoProgress } from "../session/auto-progress"
import { SessionID } from "../session/schema"

const parameters = z.object({
  action: z.enum(["start", "stop", "status"]),
  sessionId: z.string().optional(),
})

type Metadata = {
  state: "idle" | "running" | "paused"
  current_todo?: string
}

export const AutoProgressTool = Tool.define<typeof parameters, Metadata, AutoProgress.Service>(
  "auto_progress",
  Effect.gen(function* () {
    const ap = yield* AutoProgress.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const sid = (params.sessionId ?? ctx.sessionID) as SessionID

          if (params.action === "start") {
            yield* ap.start(sid)
            return {
              title: "Auto-progress started",
              output: "Auto-progress engine started for this session.",
              metadata: { state: "running" },
            }
          }

          if (params.action === "stop") {
            yield* ap.stop(sid)
            return {
              title: "Auto-progress stopped",
              output: "Auto-progress engine stopped for this session.",
              metadata: { state: "idle" },
            }
          }

          const state = yield* ap.status(sid)
          return {
            title: `Auto-progress: ${state}`,
            output: state === "running" ? "Auto-progress is running." : "Auto-progress is idle.",
            metadata: { state },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
