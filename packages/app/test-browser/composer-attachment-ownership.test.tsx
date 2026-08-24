import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createComposerAttachments } from "@/composer/attachments/attachments"
import type { ComposerPrompt } from "@/composer/types"

function target() {
  const [store, setStore] = createStore<{ prompt: ComposerPrompt; cursor: number }>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
  })
  return {
    prompt: store,
    capture: {
      current: () => store.prompt,
      cursor: () => store.cursor,
      set: (prompt: ComposerPrompt, cursor = store.cursor) => setStore({ prompt, cursor }),
    },
  }
}

describe("Composer attachment ownership", () => {
  test("keeps an async attachment with the Composer where it started", async () => {
    await new Promise<void>((resolveTest, rejectTest) => {
      createRoot((dispose) => {
        const first = target()
        const second = target()
        const stored = Promise.withResolvers<{ id: string; url: string }>()
        let active = first.capture
        const attachments = createComposerAttachments({
          capture: () => active,
          editor: () => document.createElement("div"),
          focusEditor() {},
          addPart: () => false,
          setDraggingType() {},
          directory: () => "C:/repo",
          isDialogActive: () => false,
          warn() {},
          duplicate() {},
          onError: rejectTest,
          store: () => stored.promise,
        })

        const pending = attachments.addAttachments([new File(["image"], "image.png", { type: "image/png" })])
        active = second.capture
        stored.resolve({ id: "blob-1", url: "blob:test" })
        void pending.then(() => {
          expect(first.prompt.prompt.some((part) => part.type === "image" && part.blob.id === "blob-1")).toBe(true)
          expect(second.prompt.prompt.some((part) => part.type === "image")).toBe(false)
          dispose()
          resolveTest()
        }, rejectTest)
      })
    })
  })
})
