import { expect, test } from "bun:test"
import { createPresenceReporter } from "../src/solid/presence"

type Report = { client: string; sessions: readonly string[] }

function setup(initial: { connected: boolean; sessions: string[] }) {
  const calls: Report[] = []
  const state = { connected: initial.connected, sessions: initial.sessions, fail: false }
  const api = {
    experimental: {
      session: {
        presence: async (body: Report) => {
          if (state.fail) throw new Error("presence unavailable")
          calls.push(body)
        },
      },
    },
  }
  const reporter = createPresenceReporter({
    client: "test-client",
    api: () => api,
    connected: () => state.connected,
    sessions: () => state.sessions,
    interval: 10,
  })
  return { ...reporter, state, calls }
}

// Real short intervals with deadline-bounded waits: bun's fake timers leak state across reruns.
async function until(check: () => boolean, timeout = 2_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test("reports the open set when connected", () => {
  const ctx = setup({ connected: true, sessions: ["ses_b", "ses_a"] })
  try {
    ctx.update()
    expect(ctx.calls).toEqual([{ client: "test-client", sessions: ["ses_a", "ses_b"] }])
  } finally {
    ctx.dispose()
  }
})

test("dedupes unchanged sets and reports changes", () => {
  const ctx = setup({ connected: true, sessions: ["ses_a"] })
  try {
    ctx.update()
    ctx.update()
    expect(ctx.calls).toHaveLength(1)
    ctx.state.sessions = ["ses_a", "ses_b"]
    ctx.update()
    expect(ctx.calls).toHaveLength(2)
    expect(ctx.calls[1]?.sessions).toEqual(["ses_a", "ses_b"])
  } finally {
    ctx.dispose()
  }
})

test("re-reports the same set after reconnect", () => {
  const ctx = setup({ connected: true, sessions: ["ses_a"] })
  try {
    ctx.update()
    ctx.state.connected = false
    ctx.update()
    ctx.state.connected = true
    ctx.update()
    expect(ctx.calls).toHaveLength(2)
  } finally {
    ctx.dispose()
  }
})

test("the heartbeat refreshes leases without a set change", async () => {
  const ctx = setup({ connected: true, sessions: ["ses_a"] })
  try {
    ctx.update()
    expect(ctx.calls).toHaveLength(1)
    await until(() => ctx.calls.length >= 3)
  } finally {
    ctx.dispose()
  }
})

test("does not report while disconnected", async () => {
  const ctx = setup({ connected: false, sessions: ["ses_a"] })
  try {
    ctx.update()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.calls).toEqual([])
    ctx.state.connected = true
    ctx.update()
    expect(ctx.calls).toHaveLength(1)
  } finally {
    ctx.dispose()
  }
})

test("swallows report failures and keeps reporting", () => {
  const ctx = setup({ connected: true, sessions: ["ses_a"] })
  try {
    ctx.update()
    expect(ctx.calls).toHaveLength(1)
    ctx.state.fail = true
    ctx.state.sessions = ["ses_a", "ses_b"]
    ctx.update()
    ctx.state.fail = false
    ctx.state.sessions = ["ses_a", "ses_b", "ses_c"]
    ctx.update()
    expect(ctx.calls).toHaveLength(2)
    expect(ctx.calls[1]?.sessions).toEqual(["ses_a", "ses_b", "ses_c"])
  } finally {
    ctx.dispose()
  }
})

test("stops the heartbeat on dispose", async () => {
  const ctx = setup({ connected: true, sessions: ["ses_a"] })
  ctx.update()
  ctx.dispose()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(ctx.calls).toHaveLength(1)
})
