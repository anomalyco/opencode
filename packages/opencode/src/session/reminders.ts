import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  const persistReminder = Effect.fn("SessionReminders.persistReminder")(function* (text: string) {
    const exists = userMessage.parts.some(
      (part) => part.type === "text" && part.synthetic === true && part.text === text,
    )
    if (exists) return
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text,
      synthetic: true,
    })
    userMessage.parts.push(part)
  })

  if (!flags.experimentalPlanMode) {
    const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    const reminder =
      input.agent.name === "plan" ? PROMPT_PLAN : wasPlan && input.agent.name === "build" ? BUILD_SWITCH : undefined
    const switching =
      (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") ||
      (input.agent.name === "build" && assistantMessage?.info.agent === "plan")
    const reminders = input.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && part.synthetic === true && (part.text === PROMPT_PLAN || part.text === BUILD_SWITCH)
          ? [{ message, part }]
          : [],
      ),
    )
    const keep = switching ? undefined : reminders.findLast((item) => item.part.text === reminder)
    const stale = reminders.filter((item) => item !== keep)
    yield* Effect.forEach(
      stale,
      (item) =>
        sessions.removePart({
          sessionID: item.message.info.sessionID,
          messageID: item.message.info.id,
          partID: item.part.id,
        }),
      { discard: true },
    )
    stale.forEach((item) => {
      item.message.parts = item.message.parts.filter((part) => part.id !== item.part.id)
    })
    if (!reminder || keep) return input.messages
    yield* persistReminder(reminder)
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const ctx = yield* InstanceState.context
  const plan = Session.plan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
    ),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionReminders from "./reminders"
