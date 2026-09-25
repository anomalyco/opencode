/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { onMount } from "solid-js"
import type { SlotRegistry } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { TuiHostSlotMap, TuiSlotContext, TuiSlotMap, TuiTheme } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"

type Slots = {
  prompt: {}
}

test("replace slot mounts plugin content once", async () => {
  let mounts = 0

  const Probe = () => {
    onMount(() => {
      mounts += 1
    })
    return <box />
  }

  const App = () => {
    const registry = createSolidSlotRegistry<Slots>(useRenderer(), {})
    const Slot = createSlot(registry)
    registry.register({ id: "plugin", slots: { prompt: () => <Probe /> } })

    return (
      <Slot name="prompt" mode="replace">
        <box />
      </Slot>
    )
  }

  const app = await testRender(() => <App />)
  try {
    expect(mounts).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("assistant_message_footer slot forwards full props to plugins", async () => {
  const message: AssistantMessage = {
    id: "msg-1",
    sessionID: "ses-1",
    role: "assistant",
    time: { created: 1000 },
    parentID: "usr-1",
    modelID: "model-x",
    providerID: "prov-x",
    mode: "primary",
    agent: "primary",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0.01,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 1 } },
    finish: "end_turn",
  }
  const parts: Part[] = [{ id: "p-1", sessionID: "ses-1", messageID: "msg-1", type: "text", text: "hi" }]

  let received: TuiHostSlotMap["assistant_message_footer"] | undefined
  let registry: SlotRegistry<JSX.Element, TuiSlotMap, TuiSlotContext> | undefined

  const theme = {
    current: new Proxy({}, { get: () => RGBA.fromInts(200, 200, 200) }),
  } as unknown as TuiTheme

  const App = () => {
    registry = createSolidSlotRegistry<TuiSlotMap, TuiSlotContext>(useRenderer(), { theme })
    const Slot = createSlot(registry)
    registry.register({
      id: "plugin",
      slots: {
        assistant_message_footer(_ctx, props) {
          received = props
          return <box />
        },
      },
    })

    return (
      <Slot
        name="assistant_message_footer"
        session_id={message.sessionID}
        message_id={message.id}
        message={message}
        parts={parts}
        terminal={true}
        last={true}
      />
    )
  }

  const app = await testRender(() => <App />)
  try {
    expect(received?.session_id).toBe("ses-1")
    expect(received?.message_id).toBe("msg-1")
    expect(received?.message).toBe(message)
    expect(received?.parts).toBe(parts)
    expect(received?.terminal).toBe(true)
    expect(registry!.resolveEntries("assistant_message_footer").map((entry) => entry.id)).toContain("plugin")
  } finally {
    app.renderer.destroy()
  }
})
