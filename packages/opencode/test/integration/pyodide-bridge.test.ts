import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { PyodideBridge } from "../../src/session/pyodide-bridge"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("integration.pyodide-bridge", () => {
  test("submit completes a pending run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_bridge_ok")
        const messageID = MessageID.ascending()
        const callID = "call_bridge_1"
        const run = PyodideBridge.run({
          sessionID,
          messageID,
          callID,
          code: "print(1)",
          timeout: 5000,
        })
        queueMicrotask(() => {
          PyodideBridge.submit({
            sessionID,
            callID,
            ok: true,
            output: "done\n",
            exitCode: 0,
          })
        })
        const out = await run
        expect(out.exitCode).toBe(0)
        expect(out.output).toBe("done\n")
      },
    })
  })

  test("duplicate run for same call id throws", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_bridge_dup")
        const messageID = MessageID.ascending()
        const callID = "call_bridge_dup"
        const first = PyodideBridge.run({
          sessionID,
          messageID,
          callID,
          code: "x",
          timeout: 5000,
        })
        expect(() =>
          PyodideBridge.run({
            sessionID,
            messageID,
            callID,
            code: "y",
            timeout: 5000,
          }),
        ).toThrow("duplicate pyodide request")
        PyodideBridge.submit({ sessionID, callID, ok: true, output: "", exitCode: 0 })
        await first
      },
    })
  })

  test("submit for unknown call returns false", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      fn: async () => {
        const ok = PyodideBridge.submit({
          sessionID: SessionID.make("ses_none"),
          callID: "nope",
          ok: true,
          output: "x",
          exitCode: 0,
        })
        expect(ok).toBe(false)
      },
    })
  })
})
