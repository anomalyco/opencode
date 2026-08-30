import { describe, expect, test } from "bun:test"
import AssistantMessageFooter from "../../src/feature-plugins/assistant-message-footer"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import type { TuiSlotContext, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

async function captureSlot() {
  let plugin: TuiSlotPlugin | undefined
  const api = createTuiPluginApi()
  const slots = {
    register(input: TuiSlotPlugin) {
      plugin = input
      return "x"
    },
  } as unknown as typeof api.slots
  await AssistantMessageFooter.tui({ ...api, slots } as never, undefined, {} as never)
  return plugin
}

function context() {
  return { theme: { current: {} } } as TuiSlotContext
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg-1",
    sessionID: "ses-1",
    role: "assistant",
    modelID: "model",
    providerID: "provider",
    agent: "build",
    mode: "plan",
    parentID: "user-1",
    time: { created: 0 },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as AssistantMessage
}

describe("assistant-message-footer builtin", () => {
  test("registers the footer slot at order 0", async () => {
    const plugin = await captureSlot()
    expect(plugin?.order).toBe(0)
    expect(plugin?.slots?.assistant_message_footer).toBeTypeOf("function")
  })

  test("renders nothing when not last and not terminal", async () => {
    const plugin = await captureSlot()
    const out = plugin!.slots!.assistant_message_footer!(context(), {
      session_id: "ses-1",
      message_id: "msg-1",
      message: message(),
      parts: [],
      terminal: false,
      last: false,
    })
    expect(out).toBeNull()
  })
})