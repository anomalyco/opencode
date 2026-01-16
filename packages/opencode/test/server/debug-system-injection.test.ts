import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("debug system injection", () => {
  test("injects <debug_config> into system when agent === debug", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionID = "ses_debug_system_injection_1"

    let capturedSystem: string | undefined
    const original = SessionPrompt.prompt
    ;(SessionPrompt as any).prompt = async (input: { system?: string }) => {
      capturedSystem = input.system
      return { ok: true }
    }

    try {
      await Instance.provide({
        directory: worktreeRoot,
        fn: async () => {
          const app = Server.App()
          const response = await app.request(
            `/session/${sessionID}/message?directory=${encodeURIComponent(worktreeRoot)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                agent: "debug",
                system: "BASE_SYSTEM",
                parts: [],
              }),
            },
          )

          expect(response.status).toBe(200)
          // Consume body so the stream completes
          await response.text()

          expect(capturedSystem).toBeDefined()
          expect(capturedSystem).toContain("BASE_SYSTEM")
          expect(capturedSystem).toContain("<debug_config>")
          expect(capturedSystem).toContain(`ingestUrl: http://localhost/ingest/${sessionID}`)
          expect(capturedSystem).toContain("logFileRelative: .opencode/debug.log")
          expect(capturedSystem).toContain("</debug_config>")
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = original
    }
  })

  test("does not inject <debug_config> when agent !== debug", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path
    const sessionID = "ses_non_debug_system_injection_1"

    let capturedSystem: string | undefined
    const original = SessionPrompt.prompt
    ;(SessionPrompt as any).prompt = async (input: { system?: string }) => {
      capturedSystem = input.system
      return { ok: true }
    }

    try {
      await Instance.provide({
        directory: worktreeRoot,
        fn: async () => {
          const app = Server.App()
          const response = await app.request(
            `/session/${sessionID}/message?directory=${encodeURIComponent(worktreeRoot)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                agent: "build",
                system: "BASE_SYSTEM",
                parts: [],
              }),
            },
          )

          expect(response.status).toBe(200)
          await response.text()

          expect(capturedSystem).toBe("BASE_SYSTEM")
        },
      })
    } finally {
      ;(SessionPrompt as any).prompt = original
    }
  })
})
