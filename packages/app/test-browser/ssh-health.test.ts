import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createServerHealth, type ServerHealth } from "../src/runtime/server/health"
import { ServerConnection } from "../src/runtime/server/registry"

test("SSH health is checked only with an active tunnel, and cancellation clears stale failures", async () => {
  const requests: ReturnType<typeof Promise.withResolvers<ServerHealth>>[] = []

  const app = createRoot((dispose) => {
    const [state, setState] = createStore<{ state: ServerConnection.Extension["state"] }>({ state: "stopped" })

    const connection: ServerConnection.Extension = {
      type: "extension",
      key: "ssh:fixture",
      extension: "ssh",
      connecting: false,
      authenticationRequired: false,
      managed: true,
      http: { url: "http://127.0.0.1:12345" },
      get state() {
        return state.state
      },
    }

    const health = createServerHealth(
      () => [connection],
      () => true,
      () => {
        const request = Promise.withResolvers<ServerHealth>()
        requests.push(request)

        return request.promise
      },
    )

    return { dispose, setState, health: () => health[ServerConnection.key(connection)] }
  })

  try {
    expect(app.health()).toBeUndefined()
    app.setState("state", "starting")
    app.setState("state", "auth")
    app.setState("state", "stopped")
    expect(requests).toHaveLength(0)
    expect(app.health()).toBeUndefined()
    app.setState("state", "ready")
    expect(requests).toHaveLength(1)
    expect(app.health()?.checking).toBe(true)
    app.setState("state", "auth")
    requests[0]?.resolve({ healthy: false })
    await Promise.resolve()
    expect(app.health()).toBeUndefined()
    app.setState("state", "failed")
    expect(app.health()?.healthy).toBe(false)
    app.setState("state", "auth")
    expect(app.health()).toBeUndefined()
    app.setState("state", "ready")
    requests[1]?.resolve({ healthy: false })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: false })
  } finally {
    app.dispose()
  }
})

test("a late failure from the old endpoint cannot overwrite the new endpoint check", async () => {
  const requests: ReturnType<typeof Promise.withResolvers<ServerHealth>>[] = []

  const app = createRoot((dispose) => {
    const [state, setState] = createStore({ url: "http://127.0.0.1:0" })

    const connection: ServerConnection.Extension = {
      type: "extension",
      key: "ssh:fixture",
      extension: "ssh",
      state: "ready",
      connecting: false,
      authenticationRequired: false,
      managed: true,
      get http() {
        return { url: state.url }
      },
    }

    const health = createServerHealth(
      () => [connection],
      () => true,
      () => {
        const request = Promise.withResolvers<ServerHealth>()
        requests.push(request)

        return request.promise
      },
    )

    return { dispose, setState, health: () => health[ServerConnection.key(connection)] }
  })

  try {
    app.setState({ url: "http://127.0.0.1:12345" })
    requests[0]?.resolve({ healthy: false })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: false, checking: true })
    requests[1]?.resolve({ healthy: true })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: true })
  } finally {
    app.dispose()
  }
})
