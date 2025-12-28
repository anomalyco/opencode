import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("SessionPrompt.queued", () => {
  test("returns empty array for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = SessionPrompt.queued("non-existent-session-id")
        expect(result).toEqual([])
      },
    })
  })
})

describe("SessionPrompt.getQueued", () => {
  test("returns undefined for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await SessionPrompt.getQueued("non-existent-session-id", "non-existent-message-id")
        expect(result).toBeUndefined()
      },
    })
  })
})

describe("SessionPrompt.cancelQueued", () => {
  test("returns undefined for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await SessionPrompt.cancelQueued("non-existent-session-id", "non-existent-message-id")
        expect(result).toBeUndefined()
      },
    })
  })
})
