import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import { ServerScope } from "@/utils/server-scope"

let Prompt: typeof import("@/context/prompt")
let read: ((value: string | null) => void) | undefined

const storage: AsyncStorage = {
  getItem: () => new Promise((resolve) => (read = resolve)),
  setItem: async () => undefined,
  removeItem: async () => undefined,
  clear: async () => undefined,
  key: async () => null,
  getLength: async () => 0,
  length: Promise.resolve(0),
}

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useParams: () => ({}),
    useSearchParams: () => [{}],
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "desktop", storage: () => storage }),
  }))

  Prompt = await import("@/context/prompt")
})

describe("prompt persistence", () => {
  test("waits for an async draft to hydrate before reporting ready", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const session = Prompt.createPromptSession(ServerScope.local, { draftID: "draft-async" })
        const ready = Prompt.createPromptReady(() => session)

        expect(ready()).toBe(false)
        expect(session.current()[0]).toMatchObject({ type: "text", content: "" })

        read?.(
          JSON.stringify({
            prompt: [{ type: "text", content: "persisted draft", start: 0, end: 15 }],
            cursor: 15,
            context: { items: [] },
          }),
        )

        createEffect(() => {
          if (!ready()) return
          try {
            expect(session.current()[0]).toMatchObject({ type: "text", content: "persisted draft" })
            dispose()
            resolve()
          } catch (error) {
            dispose()
            reject(error)
          }
        })
      })
    })
  })
})
