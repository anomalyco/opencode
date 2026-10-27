import { expect, test } from "bun:test"
import { emptyPrompt } from "../src/prompt/history"
import { revertMessage } from "../src/routes/session/revert"

function client(calls: string[], stage: () => Promise<void> = async () => {}) {
  return {
    api: {
      session: {
        interrupt: async () => {
          calls.push("interrupt")
        },
        wait: async () => {
          calls.push("wait")
        },
        revert: {
          stage: async () => {
            calls.push("stage")
            await stage()
          },
        },
      },
    },
  }
}

test("stops the turn and stages the revert before filling the prompt", async () => {
  const calls: string[] = []
  const prompt = { ...emptyPrompt(), text: "restored" }
  let filled = false
  await revertMessage({
    client: client(calls),
    sessionID: "ses_test",
    messageID: "msg_test",
    prompt,
    setPrompt: (value) => {
      calls.push("prompt")
      filled = value === prompt
    },
  })
  expect(calls).toEqual(["interrupt", "wait", "stage", "prompt"])
  expect(filled).toBe(true)
})

test("leaves the prompt untouched when the revert cannot be staged", async () => {
  const calls: string[] = []
  let filled = false
  await expect(
    revertMessage({
      client: client(calls, async () => {
        throw new Error("Session is busy")
      }),
      sessionID: "ses_test",
      messageID: "msg_test",
      prompt: { ...emptyPrompt(), text: "restored" },
      setPrompt: () => {
        filled = true
      },
    }),
  ).rejects.toThrow("Session is busy")
  expect(calls).toEqual(["interrupt", "wait", "stage"])
  expect(filled).toBe(false)
})

test("does not fill the prompt for messages without prompt content", async () => {
  const calls: string[] = []
  await revertMessage({
    client: client(calls),
    sessionID: "ses_test",
    messageID: "msg_test",
    setPrompt: () => {
      calls.push("prompt")
    },
  })
  expect(calls).toEqual(["interrupt", "wait", "stage"])
})
