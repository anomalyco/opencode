import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createServerHealth } from "../src/runtime/server/health"
import type { ServerProbeResult } from "../src/runtime/server/health-machine"
import type { PluginServerStatus } from "../src/runtime/server/plugin-machine"
import { ServerConnection } from "../src/runtime/server/registry"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function plugin(status: () => PluginServerStatus): ServerConnection.Plugin {
  return {
    type: "plugin",
    key: "ssh:fixture",
    plugin: "ssh",
    managed: true,
    authenticate: () => false,
    get status() {
      return status()
    },
  }
}

function probes() {
  const requests: ReturnType<typeof Promise.withResolvers<ServerProbeResult>>[] = []

  return {
    requests,
    check: () => {
      const request = Promise.withResolvers<ServerProbeResult>()
      requests.push(request)

      return request.promise
    },
  }
}

test("SSH health follows the plugin's stage and checks only an active tunnel", async () => {
  const fake = probes()
  const tunnel = { type: "ready", http: { url: "http://127.0.0.1:12345" } } as const

  const app = createRoot((dispose) => {
    const [status, setStatus] = createSignal<PluginServerStatus>({ type: "stopped" })
    const connection = plugin(status)
    const health = createServerHealth(() => [connection], fake.check)

    return { dispose, setStatus, health: () => health.status[ServerConnection.key(connection)] }
  })

  try {
    expect(app.health()).toEqual({ type: "stopped" })
    app.setStatus({ type: "starting" })
    expect(app.health()).toEqual({ type: "starting" })
    app.setStatus({ type: "auth" })
    expect(app.health()).toEqual({ type: "auth" })
    expect(fake.requests).toHaveLength(0)

    app.setStatus(tunnel)
    expect(fake.requests).toHaveLength(1)
    expect(app.health()).toEqual({ type: "checking", managed: true })

    // The tunnel asks for sign-in again before its probe answers: the late answer is stale.
    app.setStatus({ type: "auth" })
    fake.requests[0]?.resolve({ type: "unreachable" })
    await flush()
    expect(app.health()).toEqual({ type: "auth" })

    app.setStatus({ type: "failed" })
    expect(app.health()).toEqual({ type: "unreachable" })

    app.setStatus(tunnel)
    fake.requests[1]?.resolve({ type: "healthy", version: "2.0.0" })
    await flush()
    expect(app.health()).toEqual({ type: "healthy", version: "2.0.0" })
  } finally {
    app.dispose()
  }
})

test("a late failure from the old endpoint cannot overwrite the new endpoint check", async () => {
  const fake = probes()

  const app = createRoot((dispose) => {
    const [url, setUrl] = createSignal("http://127.0.0.1:12344")
    const connection = plugin(() => ({ type: "ready", http: { url: url() } }))
    const health = createServerHealth(() => [connection], fake.check)

    return { dispose, setUrl, health: () => health.status[ServerConnection.key(connection)] }
  })

  try {
    app.setUrl("http://127.0.0.1:12345")
    fake.requests[0]?.resolve({ type: "unreachable" })
    await flush()
    expect(app.health()).toEqual({ type: "checking", managed: true })
    fake.requests[1]?.resolve({ type: "healthy" })
    await flush()
    expect(app.health()).toEqual({ type: "healthy" })
  } finally {
    app.dispose()
  }
})

test("retry probes again before the next poll and resolves once that probe answers", async () => {
  const fake = probes()
  const connection: ServerConnection.Http = { type: "http", http: { url: "http://127.0.0.1:12346" } }

  const app = createRoot((dispose) => {
    const health = createServerHealth(() => [connection], fake.check)

    return { dispose, retry: health.retry, health: () => health.status[ServerConnection.key(connection)] }
  })

  try {
    fake.requests[0]?.resolve({ type: "unreachable" })
    await flush()
    expect(app.health()).toEqual({ type: "unreachable" })

    const state = { done: false }
    const retried = app.retry().then(() => (state.done = true))
    expect(fake.requests).toHaveLength(2)
    await flush()
    expect(state.done).toBe(false)
    fake.requests[1]?.resolve({ type: "healthy" })
    await retried
    expect(app.health()).toEqual({ type: "healthy" })
  } finally {
    app.dispose()
  }
})

test("disposal releases a retry whose probe never answers", async () => {
  const fake = probes()
  const connection: ServerConnection.Http = { type: "http", http: { url: "http://127.0.0.1:12347" } }

  const app = createRoot((dispose) => ({ dispose, health: createServerHealth(() => [connection], fake.check) }))

  const retried = app.health.retry()
  app.dispose()

  await retried
  expect(fake.requests).toHaveLength(2)
})
