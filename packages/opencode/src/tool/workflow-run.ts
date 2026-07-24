import { AgentV2 } from "@opencode-ai/core/agent"
import { waitForAbort } from "@opencode-ai/core/process"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Workflow } from "@opencode-ai/core/workflow"
import { WorkflowSchema } from "@opencode-ai/core/workflow/schema"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"

type Metadata = {
  [key: string]: unknown
  workflow: "heavy" | "council"
  status: WorkflowSchema.Status
  rootSessionID?: SessionSchema.ID
  childSessionIDs: ReadonlyArray<SessionSchema.ID>
  error?: string
}

const HeavyParameters = Schema.Struct({ task: Schema.String })
const CouncilParameters = Schema.Struct({ question: Schema.String })

export const HeavyRunTool = Tool.define<typeof HeavyParameters, Metadata, Workflow.Service, "heavy_run">(
  "heavy_run",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    return {
      description:
        "Execute the complete objective as a recursive, write-capable Heavy workflow with durable child sessions.",
      parameters: HeavyParameters,
      execute: (input, context) =>
        workflow
          .heavy(
            input,
            {
              sessionID: SessionSchema.ID.make(context.sessionID),
              agent: AgentV2.ID.make("heavy"),
              assistantMessageID: SessionMessage.ID.make(context.messageID),
              toolCallID: context.callID || `${context.messageID}:heavy_run`,
            },
          )
          .pipe(
            Effect.raceFirst(waitForAbort(context.abort)),
            Effect.map((output) => ({
              title: `Heavy ${output.status}`,
              metadata: {
                workflow: "heavy" as const,
                status: output.status,
                rootSessionID: output.root_session_id,
                childSessionIDs: output.nodes.map((node) => node.session_id),
              } satisfies Metadata,
              output: JSON.stringify(output, null, 2),
            })),
            Effect.catch((error) =>
              Effect.succeed({
                title: "Heavy failed",
                metadata: {
                  workflow: "heavy" as const,
                  status: "failed" as const,
                  childSessionIDs: [],
                  error: failureMessage(error),
                } satisfies Metadata,
                output: `Heavy workflow failed: ${failureMessage(error)}`,
              }),
            ),
          ),
    } satisfies Tool.DefWithoutID<typeof HeavyParameters, Metadata>
  }),
)

export const CouncilRunTool = Tool.define<typeof CouncilParameters, Metadata, Workflow.Service, "council_run">(
  "council_run",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    return {
      description:
        "Convene independent Council perspectives, run structured debate, and synthesize consensus and disagreement.",
      parameters: CouncilParameters,
      execute: (input, context) =>
        workflow
          .council(
            input,
            {
              sessionID: SessionSchema.ID.make(context.sessionID),
              agent: AgentV2.ID.make("council"),
              assistantMessageID: SessionMessage.ID.make(context.messageID),
              toolCallID: context.callID || `${context.messageID}:council_run`,
            },
          )
          .pipe(
            Effect.raceFirst(waitForAbort(context.abort)),
            Effect.map((output) => ({
              title: `Council ${output.status}`,
              metadata: {
                workflow: "council" as const,
                status: output.status,
                rootSessionID: output.root_session_id,
                childSessionIDs: [
                  ...new Set([
                    ...output.perspectives.map((perspective) => perspective.session_id),
                    ...output.debate.map((contribution) => contribution.session_id),
                  ]),
                ],
              } satisfies Metadata,
              output: JSON.stringify(output, null, 2),
            })),
            Effect.catch((error) =>
              Effect.succeed({
                title: "Council failed",
                metadata: {
                  workflow: "council" as const,
                  status: "failed" as const,
                  childSessionIDs: [],
                  error: failureMessage(error),
                } satisfies Metadata,
                output: `Council workflow failed: ${failureMessage(error)}`,
              }),
            ),
          ),
    } satisfies Tool.DefWithoutID<typeof CouncilParameters, Metadata>
  }),
)

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
