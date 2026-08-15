export * as Subagent from "./subagent.js"

import { Effect, Scope } from "effect"
import type { Agent } from "./agent.js"
import type { Job } from "./job.js"
import type { Model } from "./model.js"
import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import type { Session } from "./session.js"
import type { SessionInbox } from "./session/inbox.js"
import type { SessionMessage } from "./session/message.js"
import type { SessionSchema } from "./session/schema.js"

const NO_TEXT = "Subagent completed without a text response."

export const backgroundStarted = (sessionID: SessionSchema.ID) =>
  [
    `The subagent is working in the background (id: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
  ].join("\n")

export type Runtime = {
  readonly session: Pick<Session.Interface, "create" | "messages" | "prompt" | "resume" | "interrupt" | "synthetic">
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel">
}

export interface Input {
  readonly runtime: Runtime
  readonly scope: Scope.Scope
  readonly parentID: SessionSchema.ID
  readonly agent: Agent.ID
  readonly title: string
  readonly prompt: string
  readonly id?: SessionMessage.ID
  readonly model?: Model.Ref
  readonly files?: PromptInput.Prompt["files"]
  readonly agents?: PromptInput.Prompt["agents"]
  readonly skills?: PromptInput.Prompt["skills"]
  readonly delivery?: SessionInbox.Delivery
  readonly background: boolean
  readonly notifyStarted?: boolean
  readonly progress?: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly metadata?: Record<string, unknown>
}

export const run = Effect.fn("Subagent.run")(function* (input: Input) {
  const child = yield* input.runtime.session.create({
    parentID: input.parentID,
    title: input.title,
    agent: input.agent,
    model: input.model,
  })
  yield* input.progress?.(child.id) ?? Effect.void
  const admitted = yield* input.runtime.session.prompt({
    id: input.id,
    sessionID: child.id,
    text: input.prompt,
    files: input.files,
    agents: input.agents,
    skills: input.skills,
    delivery: input.delivery,
    resume: false,
  })
  const info = yield* input.runtime.job.start({
    id: child.id,
    type: "subagent",
    title: input.title,
    metadata: input.metadata,
    run: Effect.gen(function* () {
      yield* input.runtime.session.resume(child.id)
      const messages = yield* input.runtime.session.messages({ sessionID: child.id, order: "desc", limit: 20 })
      const assistant = messages.find(
        (message) =>
          message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
      )
      if (assistant === undefined || assistant.type !== "assistant") return NO_TEXT
      const text = assistant.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("")
      return text.length > 0 ? text : NO_TEXT
    }).pipe(Effect.onInterrupt(() => input.runtime.session.interrupt(child.id))),
  })

  if (input.background) {
    yield* input.runtime.job.background(info.id)
    if (input.notifyStarted)
      yield* notify(input, child.id, "running", backgroundStarted(child.id)).pipe(
        Effect.catchTag("Session.SyntheticConflictError", Effect.die),
      )
    yield* notifyWhenDone(input, child.id)
    return { sessionID: child.id, status: "running" as const, output: backgroundStarted(child.id), admitted }
  }

  const result = yield* input.runtime.job
    .block({ id: child.id, sessionID: input.parentID })
    .pipe(
      Effect.onInterrupt(() =>
        Effect.all([input.runtime.session.interrupt(child.id), input.runtime.job.cancel(child.id)], { discard: true }),
      ),
    )
  if (result?.type === "backgrounded") {
    yield* notifyWhenDone(input, child.id)
    return { sessionID: child.id, status: "running" as const, output: backgroundStarted(child.id), admitted }
  }
  if (result?.info.status === "error")
    return { sessionID: child.id, status: "error" as const, output: result.info.error ?? "Subagent failed", admitted }
  if (result?.info.status === "cancelled")
    return { sessionID: child.id, status: "cancelled" as const, output: "Subagent cancelled", admitted }
  return { sessionID: child.id, status: "completed" as const, output: result?.info.output ?? NO_TEXT, admitted }
})

function notifyWhenDone(input: Input, childID: SessionSchema.ID) {
  return input.runtime.job.wait({ id: childID }).pipe(
    Effect.flatMap((result) => {
      if (result.info?.status === "completed") return notify(input, childID, "completed", result.info.output ?? NO_TEXT)
      if (result.info?.status === "error")
        return notify(input, childID, "error", result.info.error ?? "Subagent failed")
      if (result.info?.status === "cancelled") return notify(input, childID, "cancelled", "Subagent cancelled")
      return Effect.void
    }),
    Effect.catchTag("Session.SyntheticConflictError", Effect.die),
    Effect.forkIn(input.scope, { startImmediately: true }),
  )
}

function notify(
  input: Input,
  childID: SessionSchema.ID,
  state: "running" | "completed" | "error" | "cancelled",
  text: string,
) {
  return input.runtime.session.synthetic({
    sessionID: input.parentID,
    text: `<subagent id="${childID}" state="${state}" description="${input.title}">\n${text}\n</subagent>`,
    description: input.title,
    metadata: { source: "subagent", ...input.metadata, childID, agent: input.agent, state },
  })
}
