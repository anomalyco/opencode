import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
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

  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      const text = yield* Effect.gen(function* () {
        if (!input.agent.planReminder) return PROMPT_PLAN
        const state = yield* planState(input.session, fsys)
        return render(input.agent.planReminder, state.planReminder)
      })
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      const text = yield* Effect.gen(function* () {
        if (!input.agent.buildSwitchReminder) return BUILD_SWITCH
        const state = yield* planState(input.session, fsys)
        return render(input.agent.buildSwitchReminder, state.buildSwitch)
      })
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text,
        synthetic: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const state = yield* planState(input.session, fsys)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: input.agent.buildSwitchReminder
        ? render(input.agent.buildSwitchReminder, state.buildSwitch)
        : state.exists
          ? `${BUILD_SWITCH}\n\n${state.buildSwitch}`
          : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const state = yield* planState(input.session, fsys)
  if (!state.exists) yield* fsys.ensureDir(path.dirname(state.filepath)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: input.agent.planReminder ? render(input.agent.planReminder, state.planReminder) : render(PLAN_MODE, state.planReminder),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

function render(template: string, planInfo: string) {
  return template.replaceAll("${planInfo}", planInfo)
}

function planState(session: Session.Info, fsys: FSUtil.Interface) {
  return Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const filepath = Session.plan(session, ctx)
    const exists = yield* fsys.existsSafe(filepath)
    return {
      exists,
      filepath,
      planReminder: exists
        ? `A plan file already exists at ${filepath}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${filepath} using the write tool.`,
      buildSwitch: exists ? `A plan file exists at ${filepath}. You should execute on the plan defined within it` : "",
    }
  })
}

export * as SessionReminders from "./reminders"
