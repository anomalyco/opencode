import { afterEach, expect, setSystemTime, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { VoiceGates } from "./gates"
import { ReplyWatch } from "./replies"
import { retargetInstructions } from "./spec"
import { TranscriptTail } from "./tail"
import { history, speech } from "./fixtures/history"

afterEach(() => setSystemTime())

test("results wait for recorded speech to end and the quiet window", () => {
  const gate = new VoiceGates()
  setSystemTime(speech.at)
  gate.assistant(true)
  expect(gate.delay()).toBe(900)
  setSystemTime(speech.end)
  gate.assistant(false)
  setSystemTime(speech.end + 899)
  expect(gate.delay()).toBe(1)
  setSystemTime(speech.end + 900)
  expect(gate.delay()).toBe(0)
})

test("results wait for two quiet seconds after the user, however long they talk", () => {
  const gate = new VoiceGates()
  setSystemTime(1000)
  gate.words()

  // The microphone keeps hearing them between transcribed words.
  for (const at of [3000, 5000, 6500]) {
    setSystemTime(at)
    gate.voice(true)
    gate.words()
  }

  setSystemTime(7000)
  gate.voice(true)
  setSystemTime(8999)
  expect(gate.delay()).toBe(1)
  setSystemTime(9000)
  expect(gate.delay()).toBe(0)
})

test("room noise without transcribed words never holds results", () => {
  const gate = new VoiceGates()
  setSystemTime(1000)
  gate.words()
  setSystemTime(7000)
  gate.voice(true)
  expect(gate.delay()).toBe(0)
})

test("a delegator answer has time to start, and the agent's speech holds results without a cap", () => {
  const gate = new VoiceGates()
  setSystemTime(1000)
  gate.answer()
  expect(gate.delay()).toBe(1200)
  setSystemTime(2000)
  gate.assistant(true)
  setSystemTime(60_000)
  expect(gate.delay()).toBe(900)
  gate.assistant(false)
  setSystemTime(60_899)
  expect(gate.delay()).toBe(1)
  setSystemTime(60_900)
  expect(gate.delay()).toBe(0)
})

test("recorded history attributes the final reply and never replays a heard result", () => {
  const watch = new ReplyWatch()
  watch.sent({
    sessionID: "ses_original",
    promptID: "msg_recorded_18",
    title: "Original session",
    instruction: "Second request",
  })
  expect(watch.reconcile("ses_original", history.slice(0, 7))).toEqual([])
  expect(watch.reconcile("ses_other", history)).toEqual([])
  expect(watch.reconcile("ses_original", history)).toEqual([
    {
      sessionID: "ses_original",
      promptID: "msg_recorded_18",
      title: "Original session",
      instruction: "Second request",
      messageID: "msg_recorded_32",
      text: "Reply 32",
    },
  ])
  watch.heard("ses_original", ["msg_recorded_32"])
  expect(watch.reconcile("ses_original", history)).toEqual([])
})

test("an unrelated later request cannot donate its answer to a voice request", () => {
  const watch = new ReplyWatch()
  watch.sent({ sessionID: "ses_original", promptID: "msg_recorded_0", title: "Original", instruction: "First request" })
  // Replay with the first idle boundary absent, as when steering arrives.
  const interrupted = history.filter((message) => message.id !== "msg_recorded_17")
  expect(watch.reconcile("ses_original", interrupted)).toEqual([])
  expect(watch.reconcile("ses_original", history).map((reply) => reply.messageID)).toEqual(["msg_recorded_16"])
})

test("utterance grouping reserves words and preserves revisions after a delegation", () => {
  const tail = new TranscriptTail()
  setSystemTime(1000)
  tail.append("user", "Please fix")
  setSystemTime(1100)
  expect(tail.append("user", " the call")).toBe("Please fix the call")
  expect(tail.capture("first")).toEqual(["user: Please fix the call"])
  expect(tail.capture("overlap")).toEqual([])
  tail.release("first")
  expect(tail.capture("retry")).toEqual(["user: Please fix the call"])
  tail.append("user", " on Desktop")
  tail.accept("retry")
  expect(tail.capture("continued")).toEqual(["user (updated utterance): Please fix the call on Desktop"])
  tail.accept("continued")
  setSystemTime(5000)
  tail.append("assistant", speech.text)
  expect(tail.capture("answer")).toEqual([`assistant: ${speech.text.trim()}`])
})

test("a subagent a voice request started in the background is announced once it reports back", () => {
  const assistant = (id: string, text: string, tools: SessionMessageAssistantTool[] = []): SessionMessageAssistant => ({
    id,
    type: "assistant",
    time: { created: 1, completed: 2 },
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [...tools, { type: "text", text }],
    finish: "stop",
  })

  const subagent = (child: string, description: string): SessionMessageAssistantTool => ({
    type: "tool",
    id: `call_${child}`,
    name: "subagent",
    state: {
      status: "completed",
      input: { agent: "general", description, prompt: description },
      content: [{ type: "text", text: "The subagent is working in the background." }],
      metadata: { sessionID: child, status: "running" },
    },
    time: { created: 1 },
  })

  const completion = (id: string, child: string) => ({
    id,
    type: "synthetic" as const,
    time: { created: 3 },
    text: `<subagent sessionID="${child}" state="completed">done</subagent>`,
    metadata: { source: "subagent", childID: child },
  })

  const idle = (id: string) => ({ id, type: "idle" as const, time: { created: 4 }, outcome: "succeeded" as const })

  const messages = [
    { id: "msg_typed", type: "user", time: { created: 1 }, text: "Typed request" },
    assistant("msg_typed_reply", "Started one too.", [subagent("ses_typed_child", "Typed work")]),
    idle("msg_idle_0"),
    { id: "msg_voice", type: "user", time: { created: 1 }, text: "Voice request" },
    assistant("msg_voice_reply", "Started a subagent on the docs.", [subagent("ses_child", "Audit the docs")]),
    idle("msg_idle_1"),
    completion("msg_typed_done", "ses_typed_child"),
    assistant("msg_typed_result", "The typed work is done."),
    idle("msg_idle_2"),
    completion("msg_done", "ses_child"),
    assistant("msg_result", "The docs audit found two broken links."),
    idle("msg_idle_3"),
  ] satisfies SessionMessageInfo[]

  const watch = new ReplyWatch()
  watch.sent({ sessionID: "ses_original", promptID: "msg_voice", title: "Original", instruction: "Voice request" })

  expect(watch.reconcile("ses_original", messages)).toEqual([
    expect.objectContaining({ messageID: "msg_voice_reply", instruction: "Voice request" }),
    expect.objectContaining({ messageID: "msg_result", instruction: "Audit the docs", background: true }),
  ])
  watch.heard("ses_original", ["msg_voice_reply", "msg_result"])
  expect(watch.reconcile("ses_original", messages)).toEqual([])
})

test("the delegator's tracked work shows a voice request running, then how it finished", () => {
  const watch = new ReplyWatch()
  watch.sent({
    sessionID: "ses_original",
    promptID: "msg_recorded_18",
    title: "Original",
    instruction: "Second request",
  })
  expect(watch.tracked()).toEqual([
    '- "Original" (id ses_original, request "Second request"): working; its reply is spoken when it lands.',
  ])
  watch.reconcile("ses_original", history)
  expect(watch.tracked()).toEqual(['- "Original" (id ses_original, request "Second request"): finished — Reply 32'])
})

test("a move's update to the voice agent stays under Live's append limit, keeping the newest messages", () => {
  const recent = Array.from({ length: 12 }, (_, index) => `assistant: ${String(index).repeat(400)}`)

  const update = retargetInstructions(
    { session: { id: "ses_b", title: "B" }, project: "app", working: true, recent },
    "user",
  )

  expect(update.length).toBeLessThanOrEqual(1700)
  expect(update).toContain("It is working.")
  expect(update).toContain(`assistant: ${"1".repeat(40)}`)
  expect(update).not.toContain(`assistant: ${"5".repeat(40)}`)
})

test("a move's update waits for the reply the user is owed, then for the agent to finish speaking", () => {
  const gate = new VoiceGates()
  setSystemTime(1000)
  gate.words()
  setSystemTime(3500)
  expect(gate.context()).toBe(5500)
  setSystemTime(4000)
  gate.assistant(true)
  setSystemTime(6000)
  expect(gate.context()).toBe(900)
  gate.assistant(false)
  setSystemTime(6900)
  expect(gate.context()).toBe(0)
})
