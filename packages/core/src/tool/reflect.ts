export * as ReflectTool from "./reflect"

import { ToolFailure } from "@opencode-ai/llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { SessionEvent } from "../session/event"
import { SessionRunner } from "../session/runner"
import * as SessionRunnerLLM from "../session/runner/llm"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "reflect"

const Loop = Schema.Literals(["why", "then"])

export const Input = Schema.Struct({
  loop: Loop.annotate({
    description:
      "Why iterates reflection from the current state backward to ground the goal; Then projects the current state forward to surface consequences, contradictions, or risks.",
  }),
  reason: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Optional justification for invoking the loop. The runner captures this in the cycle event for downstream diagnostics.",
  }),
})

export const Output = Schema.Struct({
  loop: Loop,
  steered: Schema.Boolean.annotate({
    description:
      "Whether the loop admitted a steered session input. False means the Meta-Mirror / Then Loop converged without needing intervention.",
  }),
  converged: Schema.Boolean.annotate({
    description:
      "Whether the Kleene iterate stabilized within the configured budget. False means the loop was budget-bounded.",
  }),
  iterates: Schema.Number.annotate({
    description: "Number of provider-turn iterations the loop performed on this invocation.",
  }),
  epsilon: Schema.Number.annotate({
    description:
      "ε bound from the ε-TCAA certificate (paper Def. 14.3). Defaults to 0 when no tolerance is configured.",
  }),
  approximationGap: Schema.Number.pipe(Schema.optional).annotate({
    description:
      "When the loop converged, the approximation gap ρ(R(x*), x*). Absent when the loop did not converge or no ε was configured.",
  }),
  extensionsDetected: Schema.Number.annotate({
    description:
      "Count of Session Context Epoch boundaries crossed during the iterate. Non-zero indicates transfinite cofinality (paper §13.4).",
  }),
  text: Schema.String.annotate({
    description:
      "The reflection or projection text. For Why, the new goal if changed; for Then, the forward projection if risks were found; otherwise a short convergence notice.",
  }),
})
export type Output = typeof Output.Type

const whyConverged = "Goal unchanged. Meta-Mirror converged."
const thenConverged = "No issues projected. Then Loop converged."
const whySteered = "Reflection admitted as a steered input; the Session will continue with the new goal applied."
const thenSteered =
  "Forward projection admitted as a steered input; the Session will continue with the risks surfaced."

const statusText = (loop: "why" | "then", steered: boolean) => {
  if (loop === "why") return steered ? whySteered : whyConverged
  return steered ? thenSteered : thenConverged
}

const modelOutput = (output: Output) => output.text

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const permission = yield* PermissionV2.Service
    const runner = yield* SessionRunner.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Invoke a reflective fixed-point pass over the current Session history. Pass loop=why for the Why Loop: post-decision reflection on whether the latest information changed the goal, returning the Meta-Mirror at μR. Pass loop=then for the Then Loop: forward projection from the current state τR(x), surfacing risks the next 3-5 steps would hit. When the loop admits a steered session input the runner continues with that input applied; otherwise the loop converged and the Session may settle.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: modelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({
                  action: name,
                  resources: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                .pipe(Effect.mapError(() => new ToolFailure({ message: `Permission denied: ${name}` })))

              const result =
                input.loop === "why"
                  ? yield* runner.whyLoop(context.sessionID)
                  : yield* runner.thenLoop(context.sessionID)

              yield* events
                .publish(SessionEvent.ReasoningCycle.Fired, {
                  loop: input.loop,
                  gated: false,
                  steered: result.steered,
                  iterates: result.iterates,
                  epsilon: result.certificate.epsilon,
                  ...(result.certificate.approximationGap === undefined
                    ? {}
                    : { approximationGap: result.certificate.approximationGap }),
                  timestamp: yield* DateTime.now,
                  sessionID: context.sessionID,
                  messageID: context.assistantMessageID,
                  ...(input.reason === undefined ? {} : { reason: input.reason }),
                })
                .pipe(Effect.ignore, Effect.asVoid)

              return {
                loop: input.loop,
                steered: result.steered,
                converged: result.converged,
                iterates: result.iterates,
                epsilon: result.certificate.epsilon,
                ...(result.certificate.approximationGap === undefined
                  ? {}
                  : { approximationGap: result.certificate.approximationGap }),
                extensionsDetected: result.extensionsDetected,
                text: result.text === "" ? statusText(input.loop, result.steered) : result.text,
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/reflect",
  layer,
  deps: [PermissionV2.node, SessionRunnerLLM.node, EventV2.node, ToolRegistry.toolsNode],
})
