import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.prompt_async", () => {
  test("does not emit unhandled rejection when prompt is aborted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})
        const promptSpy = spyOn(SessionPrompt, "prompt").mockRejectedValue(new DOMException("Aborted", "AbortError"))
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => {
          unhandled.push(reason)
        }

        process.on("unhandledRejection", onUnhandled)

        try {
          const response = await app.request(`/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              parts: [{ type: "text", text: "queued prompt" }],
              agent: "build",
            }),
          })

          expect(response.status).toBe(204)

          await new Promise((resolve) => setTimeout(resolve, 10))

          expect(unhandled).toHaveLength(0)
        } finally {
          process.off("unhandledRejection", onUnhandled)
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })
})
