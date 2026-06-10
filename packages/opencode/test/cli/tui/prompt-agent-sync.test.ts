import { expect, test } from "bun:test"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { syncPromptMetadataFromUserMessage } from "../../../src/cli/cmd/tui/component/prompt"

const sessionID = "ses_agent_sync"
const model = { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } satisfies UserMessage["model"]
const modelWithVariant = { ...model, variant: "thinking" } satisfies UserMessage["model"]
const agents = [{ name: "plan" }, { name: "build" }]

function userMessage(input: { id: string; agent: string; model?: UserMessage["model"]; omitModel?: boolean }): UserMessage {
  const base = {
    id: input.id,
    sessionID,
    role: "user" as const,
    agent: input.agent,
    time: { created: 0 },
  }

  if (input.omitModel) return base as UserMessage

  return {
    ...base,
    model: input.model ?? model,
  }
}

function createRecorder() {
  const agentUpdates: string[] = []
  const modelUpdates: UserMessage["model"][] = []
  const variantUpdates: Array<string | undefined> = []

  return {
    agentUpdates,
    modelUpdates,
    variantUpdates,
    sync: (input: {
      message?: UserMessage
      syncedKey?: string
      sessionID?: string
      agents?: typeof agents
      argsAgent?: string
    }) =>
      syncPromptMetadataFromUserMessage({
        sessionID: "sessionID" in input ? input.sessionID : sessionID,
        message: input.message,
        syncedKey: input.syncedKey,
        agents: input.agents ?? agents,
        argsAgent: input.argsAgent,
        setAgent: (name) => agentUpdates.push(name),
        setModel: (next) => modelUpdates.push(next),
        setVariant: (next) => variantUpdates.push(next),
      }),
  }
}

test("prompt metadata sync follows a plugin-created user message in the same session", () => {
  const recorder = createRecorder()

  const sync = (message: UserMessage, syncedKey: string | undefined) =>
    syncPromptMetadataFromUserMessage({
      sessionID,
      message,
      syncedKey,
      agents,
      argsAgent: undefined,
      setAgent: (name) => recorder.agentUpdates.push(name),
      setModel: (next) => recorder.modelUpdates.push(next),
      setVariant: (next) => recorder.variantUpdates.push(next),
    })

  const syncedPlan = sync(userMessage({ id: "msg_plan", agent: "plan" }), undefined)
  const syncedBuild = sync(userMessage({ id: "msg_build", agent: "build" }), syncedPlan)

  expect(syncedPlan).toBe(`${sessionID}:msg_plan`)
  expect(syncedBuild).toBe(`${sessionID}:msg_build`)
  expect(recorder.agentUpdates).toEqual(["plan", "build"])
  expect(recorder.modelUpdates).toEqual([model, model])
  expect(recorder.variantUpdates).toEqual([undefined, undefined])
})

test("prompt metadata sync is a no-op without a session or message", () => {
  const recorder = createRecorder()

  expect(recorder.sync({ sessionID: undefined, message: userMessage({ id: "msg_plan", agent: "plan" }), syncedKey: "previous" })).toBe(
    "previous",
  )
  expect(recorder.sync({ message: undefined, syncedKey: "previous" })).toBe("previous")
  expect(recorder.agentUpdates).toEqual([])
  expect(recorder.modelUpdates).toEqual([])
  expect(recorder.variantUpdates).toEqual([])
})

test("prompt metadata sync skips non-primary agents", () => {
  const recorder = createRecorder()

  expect(recorder.sync({ message: userMessage({ id: "msg_subagent", agent: "reviewer" }) })).toBe(
    `${sessionID}:msg_subagent`,
  )
  expect(recorder.agentUpdates).toEqual([])
  expect(recorder.modelUpdates).toEqual([])
  expect(recorder.variantUpdates).toEqual([])
})

test("prompt metadata sync preserves command line agent while syncing model metadata", () => {
  const recorder = createRecorder()

  expect(
    recorder.sync({
      message: userMessage({ id: "msg_build", agent: "build", model: modelWithVariant }),
      argsAgent: "plan",
    }),
  ).toBe(`${sessionID}:msg_build`)
  expect(recorder.agentUpdates).toEqual([])
  expect(recorder.modelUpdates).toEqual([modelWithVariant])
  expect(recorder.variantUpdates).toEqual(["thinking"])
})

test("prompt metadata sync is idempotent for the same message key", () => {
  const recorder = createRecorder()
  const message = userMessage({ id: "msg_plan", agent: "plan" })

  const syncedKey = recorder.sync({ message })

  expect(recorder.sync({ message, syncedKey })).toBe(syncedKey)
  expect(recorder.agentUpdates).toEqual(["plan"])
  expect(recorder.modelUpdates).toEqual([model])
  expect(recorder.variantUpdates).toEqual([undefined])
})

test("prompt metadata sync does not update model metadata when the message has no model", () => {
  const recorder = createRecorder()

  expect(recorder.sync({ message: userMessage({ id: "msg_plan", agent: "plan", omitModel: true }) })).toBe(
    `${sessionID}:msg_plan`,
  )
  expect(recorder.agentUpdates).toEqual(["plan"])
  expect(recorder.modelUpdates).toEqual([])
  expect(recorder.variantUpdates).toEqual([])
})

test("prompt metadata sync updates the model variant when present", () => {
  const recorder = createRecorder()

  expect(recorder.sync({ message: userMessage({ id: "msg_plan", agent: "plan", model: modelWithVariant }) })).toBe(
    `${sessionID}:msg_plan`,
  )
  expect(recorder.agentUpdates).toEqual(["plan"])
  expect(recorder.modelUpdates).toEqual([modelWithVariant])
  expect(recorder.variantUpdates).toEqual(["thinking"])
})
