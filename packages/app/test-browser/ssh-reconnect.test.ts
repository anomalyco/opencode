import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSshReconnect } from "../src/servers/ssh/reconnect-state"
import type { SshItem } from "../src/servers/ssh/types"

function fixture() {
  return createRoot((dispose) => {
    const config = { id: "host", target: "ssh linuxbook", name: "" }
    const [state, setState] = createStore<{ items: SshItem[]; busy: boolean }>({
      items: [{ config, stage: "disconnected", saved: true, detail: "" }],
      busy: false,
    })
    const calls = { starts: 0, prompts: 0, errors: 0, connected: 0 }
    const admission = Promise.withResolvers<void>()
    const reconnect = createSshReconnect({
      items: () => state.items,
      busy: () => state.busy,
      start: () => {
        calls.starts++
        return admission.promise
      },
      prompt: () => {
        calls.prompts++
      },
      error: () => {
        calls.errors++
      },
    })
    return { dispose, config, setState, calls, admission, reconnect }
  })
}

test("key-based reconnect stays pending without a dialog and suppresses duplicate clicks", async () => {
  const app = fixture()
  try {
    app.reconnect.start(app.config, () => {
      app.calls.connected++
    })
    app.reconnect.start(app.config)
    expect(app.reconnect.pending("host")).toBe(true)
    app.setState("items", 0, "stage", "connecting")
    app.admission.resolve()
    await app.admission.promise
    await Promise.resolve()
    expect(app.calls.starts).toBe(1)
    expect(app.calls.prompts).toBe(0)
    expect(app.reconnect.pending("host")).toBe(true)
    app.setState("items", 0, "stage", "ready")
    await Promise.resolve()
    expect(app.reconnect.pending("host")).toBe(false)
    expect(app.calls.connected).toBe(1)
    expect(app.calls.prompts).toBe(0)
  } finally {
    app.dispose()
  }
})

test("reconnect opens only the actual SSH challenge and does not restart on later prompts", async () => {
  const app = fixture()
  try {
    app.reconnect.start(app.config)
    app.setState("items", 0, "stage", "connecting")
    app.admission.resolve()
    await app.admission.promise
    await Promise.resolve()
    app.setState("items", 0, "stage", "authentication")
    expect(app.calls.prompts).toBe(0)
    app.setState("items", 0, "prompt", { id: "password", text: "Password:", confirm: false })
    expect(app.calls.prompts).toBe(1)
    app.setState("items", 0, "prompt", { id: "otp", text: "Code:", confirm: false })
    expect(app.calls.prompts).toBe(1)
    expect(app.calls.starts).toBe(1)
    app.setState("items", 0, { stage: "authentication", prompt: undefined })
    expect(app.reconnect.pending("host")).toBe(false)
    app.reconnect.start(app.config)
    expect(app.reconnect.pending("host")).toBe(true)
  } finally {
    app.dispose()
  }
})

test("failed reconnect becomes retryable without opening a connection form", async () => {
  const app = fixture()
  try {
    app.reconnect.start(app.config)
    app.setState("items", 0, "stage", "connecting")
    app.admission.resolve()
    await app.admission.promise
    await Promise.resolve()
    app.setState("items", 0, "stage", "failed")
    expect(app.reconnect.pending("host")).toBe(false)
    expect(app.calls.prompts).toBe(0)
    app.reconnect.start(app.config)
    expect(app.reconnect.pending("host")).toBe(true)
  } finally {
    app.dispose()
  }
})
