import { describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tui.publish", () => {
  test("publishes tui.window.focus events", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const eventPromise = new Promise((resolve) => {
          const stop = Bus.subscribe(TuiEvent.WindowFocus, (event) => {
            stop()
            resolve(event)
          })
        })

        const app = Server.App()
        const response = await app.request("/tui/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: {
              type: "tui.window.focus",
              properties: { focused: false },
            },
          }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)

        const event = await eventPromise

        expect(event).toEqual({
          type: "tui.window.focus",
          properties: { focused: false },
        })
      },
    })
  })
})
