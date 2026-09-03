import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { isServer } from "solid-js/web"
import { OpenCode } from "../src/promise"
import { createClientConnection } from "../src/solid"

test.skipIf(isServer)("backs off repeated event stream failures", async () => {
  const attempts: number[] = []
  const api = OpenCode.make({
    baseUrl: "http://offline.example",
    fetch: async () => {
      attempts.push(Date.now())
      throw new TypeError("Server is offline")
    },
  })
  const setup = createRoot((dispose) => ({
    connection: createClientConnection(api, { onEvent() {} }),
    dispose,
  }))

  try {
    await Bun.sleep(2_500)
    expect(attempts.length).toBe(2)
    expect(setup.connection.attempt()).toBe(2)
  } finally {
    setup.dispose()
  }
})
