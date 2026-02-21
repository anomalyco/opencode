import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.prompt cancel", () => {
  test("rejects queued loop callbacks", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const command = process.platform === "win32" ? "ping -n 6 127.0.0.1 >nul" : "sleep 5"

        const running = SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          command,
        })
        void running.catch(() => {})

        const queued = SessionPrompt.loop({ sessionID: session.id })
        SessionPrompt.cancel(session.id)

        const result = await Promise.race([
          queued.then(
            () => ({ type: "resolved" as const }),
            (error) => ({ type: "rejected" as const, error }),
          ),
          Bun.sleep(200).then(() => ({ type: "timeout" as const })),
        ])

        expect(result.type).toBe("rejected")
        if (result.type === "rejected") {
          expect(result.error).toBeInstanceOf(Error)
          expect((result.error as Error).message).toBe("Session cancelled")
        }

        await Session.remove(session.id)
      },
    })
  })
})
