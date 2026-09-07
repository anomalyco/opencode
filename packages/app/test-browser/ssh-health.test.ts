import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createServerHealth, type ServerHealth } from "../src/runtime/server/health"
import { ServerConnection } from "../src/runtime/server/registry"

function fixture() {
  const requests: ReturnType<typeof Promise.withResolvers<ServerHealth>>[] = []
  return createRoot((dispose) => {
    const [state, setState] = createStore({ url: "http://127.0.0.1:0", connecting: true })
    const connection: ServerConnection.Ssh = {
      type: "ssh",
      id: "fixture",
      host: "devbox",
      get http() {
        return { url: state.url }
      },
      get connecting() {
        return state.connecting
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
    return { dispose, setState, requests, health: () => health[ServerConnection.key(connection)] }
  })
}

test("a new SSH endpoint stays checking after connection completes instead of showing the old failure", async () => {
  const app = fixture()
  try {
    app.requests[0]?.resolve({ healthy: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(app.health()?.healthy).toBe(false)
    app.setState({ url: "http://127.0.0.1:12345", connecting: false })
    expect(app.health()).toEqual({ healthy: false, checking: true })
    app.requests[1]?.resolve({ healthy: true, version: "2.0.0" })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: true, version: "2.0.0" })
  } finally {
    app.dispose()
  }
})

test("a late failure from the old endpoint cannot overwrite the new endpoint check", async () => {
  const app = fixture()
  try {
    app.setState({ url: "http://127.0.0.1:12345", connecting: false })
    app.requests[0]?.resolve({ healthy: false })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: false, checking: true })
    app.requests[1]?.resolve({ healthy: true })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: true })
  } finally {
    app.dispose()
  }
})

test("a failed check of the new tunnel stops checking and still reports failure", async () => {
  const app = fixture()
  try {
    app.setState({ url: "http://127.0.0.1:12345", connecting: false })
    expect(app.health()?.checking).toBe(true)
    app.requests[1]?.resolve({ healthy: false })
    await Promise.resolve()
    expect(app.health()).toEqual({ healthy: false })
  } finally {
    app.dispose()
  }
})
