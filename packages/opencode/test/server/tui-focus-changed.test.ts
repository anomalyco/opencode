import { describe, expect, test } from "bun:test"
import path from "path"
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tui.publish focus", () => {
  test("publishes tui.focus.changed", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const event = new Promise((resolve) => {
          const stop = Bus.subscribe(TuiEvent.FocusChanged, (event) => {
            stop()
            resolve(event)
          })
        })

        const app = Server.Default()
        const res = await app.request("/tui/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: TuiEvent.FocusChanged.type,
            properties: { focused: false },
          }),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(await event).toEqual({
          type: TuiEvent.FocusChanged.type,
          properties: { focused: false },
        })
      },
    })
  })
})
