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
import { Todo } from "./todo"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"

// Number of consecutive tool-using assistant steps without a todowrite call before the model is reminded.
export const TODO_STALE_STEPS = 3

// Counts assistant steps in the current turn that ran tools without touching todowrite.
// Returns undefined when there is no user message to anchor the turn.
export function todoStaleSteps(messages: SessionV1.WithParts[]) {
  const start = messages.findLastIndex((msg) => msg.info.role === "user")
  if (start === -1) return
  let count = 0
  for (let i = messages.length - 1; i > start; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    const tools = msg.parts.filter((part) => part.type === "tool")
    if (tools.length === 0) continue
    if (tools.some((part) => part.tool === "todowrite")) return count
    count++
  }
  return count
}

export function todoReminder(todos: ReadonlyArray<Todo.Info>) {
  const open = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
  if (open.length === 0) return
  return [
    "<system-reminder>",
    `The todo list still has ${open.length} open item(s):`,
    ...open.map((todo) => `- [${todo.status}] ${todo.content}`),
    "If any of these are actually finished, call todowrite now to mark them completed before continuing. Keep exactly one item in_progress while work remains. This is an automated reminder, not a message from the user.",
    "</system-reminder>",
  ].join("\n")
}

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const todo = yield* Todo.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  const stale = todoStaleSteps(input.messages)
  if (stale !== undefined && stale >= TODO_STALE_STEPS) {
    const text = todoReminder(yield* todo.get(input.session.id))
    if (text) {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text,
        synthetic: true,
      })
    }
  }

  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        synthetic: true,
      })
    }
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
