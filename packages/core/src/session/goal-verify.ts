export * as SessionGoalVerify from "./goal-verify.js"

import { LLMClient, LLMEvent, Message, SystemPart } from "@opencode/ai"
import type { Agent } from "@opencode/schema/agent"
import type { FileDiff } from "@opencode/schema/file-diff"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import type { Content } from "@opencode/schema/tool"
import type { SessionTitle } from "@opencode/plugin/effect/session"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { makeGlobalNode, Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { LocationServiceMap } from "../location-service-map.js"
import { SessionContext } from "./context.js"
import { SessionDiff } from "./diff.js"
import { SessionEvent } from "./event.js"
import { SessionGoal } from "./goal.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionUsage } from "./usage.js"

/** One finished tool call, reduced to what a verifier may rely on. */
interface ToolEvidence {
  readonly name: string
  readonly status: "completed" | "error"
  readonly exit?: number
  readonly output: string
}

const MAX_TOOL_OUTPUT = 2_000
const MAX_EVIDENCE = 24_000

/**
 * The verifier's answer. Decoding is fail-closed: an answer that does not decode
 * is treated as `incomplete`, so a malformed reply can never complete a goal.
 */
export interface Verdict extends Schema.Schema.Type<typeof Verdict> {}
export const Verdict = Schema.Struct({
  verdict: Schema.Literals(["complete", "incomplete"]),
  unmet: Schema.Array(
    Schema.Struct({
      position: Schema.Number,
      reason: Schema.String,
    }),
  ),
  evidence: Schema.String,
}).annotate({ identifier: "SessionGoalVerify.Verdict" })

const SYSTEM = [
  "You verify whether a goal's todo list is actually done.",
  "You see only evidence: the files this session changed, the finished tool calls with their exit codes and output, and each todo item's acceptance criterion.",
  "You never see the assistant's own prose, so never take a claim of completion on trust.",
  "Mark an item unmet unless the evidence shows its acceptance criterion holds; when in doubt, mark it unmet.",
  'Answer with JSON only, no prose and no code fence: {"verdict":"complete"|"incomplete","unmet":[{"position":<number>,"reason":"<why>"}],"evidence":"<what you relied on>"}',
].join("\n")

export interface Interface {
  /**
   * Judges the session's active goal against recorded evidence and publishes one
   * `session.todo.verified`. A no-op without an active goal, and a no-op when
   * the goal moved on while the verdict was in flight.
   *
   * `context` is the Session's own Location-scoped request builder, passed in by
   * the caller that already holds it: this service is process-global, and
   * resolving a Location layer from inside it would make the instance graph
   * reference itself.
   */
  readonly verify: (sessionID: SessionSchema.ID, context: SessionContext.Interface) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoalVerify") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const store = yield* SessionStore.Service
    const goal = yield* SessionGoal.Service
    const locations = yield* LocationServiceMap.Service
    const db = (yield* Database.Service).db

    const prepare = Effect.fn("SessionGoalVerify.prepare")(function* (input: {
      readonly session: SessionSchema.Info
      readonly context: SessionContext.Interface
      readonly text: string
    }) {
      const selection = yield* input.context.selectTitle(input.session)
      if (!selection) return
      const prepared = yield* input.context.request.title({
        session: input.session,
        agent: selection.agent.id,
        model: selection.selected,
        system: [SystemPart.make(SYSTEM)],
        messages: [Message.user(input.text)],
      })
      return { selection, prepared }
    })

    const attempt = Effect.fn("SessionGoalVerify.attempt")(function* (input: {
      readonly session: SessionSchema.Info
      readonly agent: Agent.ID
      readonly model: SessionRunnerModel.Resolved
      readonly prepared: SessionModelRequest.Prepared<SessionTitle>
    }) {
      const chunks: string[] = []
      let failed = false
      let usage: SessionUsage.Recorded | undefined
      const recordUsage = Effect.suspend(() =>
        usage
          ? bus.publish(SessionEvent.UsageRecorded, {
              sessionID: input.session.id,
              source: "goal-verify",
              ...usage,
            })
          : Effect.void,
      )
      if (input.prepared.event.result !== undefined) return input.prepared.event.result
      yield* llm.stream(input.prepared.request, input.prepared.options).pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          if (LLMEvent.is.stepFinish(event)) {
            const step = SessionUsage.record(event.usage, input.model.cost)
            usage = usage ? SessionUsage.add(usage, step) : step
          }
          return Effect.void
        }),
        Effect.catchTag("AI.Error", () =>
          Effect.sync(() => {
            failed = true
          }),
        ),
        Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
      )
      yield* recordUsage
      if (failed) return
      return chunks.join("")
    })

    const verify = Effect.fn("SessionGoalVerify.verify")(function* (
      sessionID: SessionSchema.ID,
      context: SessionContext.Interface,
    ) {
      const session = yield* store.get(sessionID)
      if (!session) return
      const current = yield* goal.read(sessionID)
      if (current?.phase !== "active") return
      const todo = yield* goal.readTodo(sessionID)
      const text = yield* evidence({ session, objective: current.objective, todo })
      const prepared = yield* prepare({ session, context, text }).pipe(Effect.orElseSucceed(() => undefined))
      if (!prepared) return
      const answer = yield* attempt({
        session,
        agent: prepared.selection.agent.id,
        model: prepared.selection.selected,
        prepared: prepared.prepared,
      })
      const verdict = answer === undefined ? undefined : parseVerdict(answer)
      const items = applyVerdict(todo, verdict)
      yield* bus.publish(SessionEvent.Todo.Verified, { sessionID, revision: current.revision, items })
      // The model's verdict is necessary, never sufficient: the code gate below is
      // the authority on completion, so a verdict cannot tick an item the list
      // still shows as open.
      if (isComplete(items, verdict)) yield* goal.complete(sessionID)
    })

    const evidence = Effect.fn("SessionGoalVerify.evidence")(function* (input: {
      readonly session: SessionSchema.Info
      readonly objective: string
      readonly todo: ReadonlyArray<SessionGoalSchema.TodoItem>
    }) {
      const messages = yield* store.context(input.session.id).pipe(Effect.orElseSucceed(() => []))
      const files = yield* SessionDiff.turn(db, locations, {
        session: input.session,
        active: false,
        context: 0,
      }).pipe(Effect.orElseSucceed(() => []))
      return renderEvidence({
        objective: input.objective,
        todo: input.todo,
        files,
        tools: messages.flatMap((message) =>
          message.type === "assistant" ? message.content.flatMap(toolEvidence) : [],
        ),
      })
    })

    return Service.of({ verify })
  }),
)

// Annotated like Session.node: the layer reaches Instance.Services through
// SessionDiff.turn, and inferring the provider would make that alias reference
// itself through the plugin requirements.
export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient, SessionStore.node, SessionGoal.node, LocationServiceMap.node, Database.node],
})

/** The model's answer, or undefined when it is not a decodable verdict. */
export const parseVerdict = (text: string) => {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Verdict))(text.slice(start, end + 1)))
}

/**
 * One verdict per todo position. A position the verdict names as unmet keeps its
 * status and carries the reason; every other position is completed only when the
 * verdict itself is `complete`.
 */
export const applyVerdict = (
  todo: ReadonlyArray<SessionGoalSchema.TodoItem>,
  verdict: Verdict | undefined,
): ReadonlyArray<SessionGoalSchema.TodoVerification> => {
  const unmet = new Map((verdict?.unmet ?? []).map((item) => [item.position, item.reason]))
  return todo.map((item) => {
    const reason = unmet.get(item.position)
    if (verdict?.verdict === "complete" && reason === undefined && item.status !== "cancelled")
      return { position: item.position, status: "completed" as const, feedback: "" }
    return { position: item.position, status: item.status, feedback: reason ?? "" }
  })
}

/** True when a verdict leaves the item in a terminal state. */
export const isSettled = (item: SessionGoalSchema.TodoVerification) =>
  item.status === "completed" || item.status === "cancelled"

/**
 * The code gate on completion. A complete verdict only finishes a non-empty
 * list whose every item is settled: an empty list means the model has not
 * written the work down yet, so it is never done.
 */
export const isComplete = (
  items: ReadonlyArray<SessionGoalSchema.TodoVerification>,
  verdict: Verdict | undefined,
) => verdict?.verdict === "complete" && items.length > 0 && items.every(isSettled)

const toolEvidence = (part: SessionMessage.AssistantContent): ReadonlyArray<ToolEvidence> => {
  if (part.type !== "tool") return []
  if (part.state.status === "completed")
    return [
      {
        name: part.name,
        status: "completed",
        exit: exitCode(part.state.metadata),
        output: contentText(part.state.content),
      },
    ]
  if (part.state.status === "error") return [{ name: part.name, status: "error", output: part.state.error.message }]
  return []
}

/** The shell tool records its process exit code in the tool result metadata. */
const exitCode = (metadata: Readonly<Record<string, unknown>> | undefined) => {
  const exit = metadata?.exit
  return typeof exit === "number" ? exit : undefined
}

const contentText = (content: ReadonlyArray<Content>) =>
  content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")

const renderEvidence = (input: {
  readonly objective: string
  readonly todo: ReadonlyArray<SessionGoalSchema.TodoItem>
  readonly files: ReadonlyArray<FileDiff.Info>
  readonly tools: ReadonlyArray<ToolEvidence>
}) =>
  [
    `Objective:\n${input.objective}`,
    `Todo list:\n${renderTodo(input.todo)}`,
    `Files this session changed:\n${renderFiles(input.files)}`,
    `Finished tool calls:\n${renderTools(input.tools)}`,
  ]
    .join("\n\n")
    .slice(0, MAX_EVIDENCE)

const renderTodo = (todo: ReadonlyArray<SessionGoalSchema.TodoItem>) =>
  todo.length === 0
    ? "(the list is empty)"
    : todo
        .map(
          (item) =>
            `- [${item.position}] ${item.status}: ${item.content}\n  acceptance: ${item.acceptance ?? "(none given)"}`,
        )
        .join("\n")

const renderFiles = (files: ReadonlyArray<FileDiff.Info>) =>
  files.length === 0
    ? "(no recorded file changes)"
    : files.map((file) => `- ${file.status} ${file.file} (+${file.additions}/-${file.deletions})`).join("\n")

const renderTools = (tools: ReadonlyArray<ToolEvidence>) =>
  tools.length === 0
    ? "(no finished tool calls)"
    : tools
        .map((tool) => {
          const exit = tool.exit === undefined ? "" : ` exit=${tool.exit}`
          return `- ${tool.name} ${tool.status}${exit}\n${tool.output.slice(0, MAX_TOOL_OUTPUT)}`
        })
        .join("\n")
