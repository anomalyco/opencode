import { expect, test } from "bun:test"
import { revertMessage } from "../src/routes/session/revert"

function client(calls: string[], hooks: { wait?: () => Promise<void>; stage?: () => Promise<void> } = {}) {
  return {
    api: {
      session: {
        interrupt: async () => {
          calls.push("interrupt")
        },
        revert: {
          stage: async () => {
            calls.push("stage")
            await hooks.stage?.()
          },
        },
      },
      experimental: {
        session: {
          wait: async () => {
            calls.push("wait")
            await hooks.wait?.()
          },
        },
      },
    },
  }
}

test("settles the running turn before staging the revert", async () => {
  const calls: string[] = []
  await revertMessage({ client: client(calls), sessionID: "ses_test", messageID: "msg_test" })
  expect(calls).toEqual(["interrupt", "wait", "stage"])
})

test("does not stage the revert when the turn never settles", async () => {
  const calls: string[] = []
  await expect(
    revertMessage({
      client: client(calls, {
        wait: async () => {
          throw new Error("Session is still running")
        },
      }),
      sessionID: "ses_test",
      messageID: "msg_test",
    }),
  ).rejects.toThrow("Session is still running")
  expect(calls).toEqual(["interrupt", "wait"])
})

test("propagates a stage failure after the turn settled", async () => {
  const calls: string[] = []
  await expect(
    revertMessage({
      client: client(calls, {
        stage: async () => {
          throw new Error("Session is busy")
        },
      }),
      sessionID: "ses_test",
      messageID: "msg_test",
    }),
  ).rejects.toThrow("Session is busy")
  expect(calls).toEqual(["interrupt", "wait", "stage"])
})
