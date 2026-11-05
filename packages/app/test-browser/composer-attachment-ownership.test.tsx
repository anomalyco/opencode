import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createComposerAttachments } from "@/composer/attachments/attachments"
import { createMemoryComposerState } from "@/composer/state"
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
          destination: () => ({
            input: { image: true, pdf: true },
            local: false,
            upload: () => Promise.reject(new Error("native attachments must not upload")),
          }),
          isDialogActive: () => false,
          duplicate() {},
          onError: rejectTest,
          onUploadError: rejectTest,
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

  test("keeps an upload pending for its draft across a remount, and stops it when the draft closes", async () => {
    const draft = createRoot((dispose) => ({ state: createMemoryComposerState(), dispose }))
    const prompt = target()
    let signal: AbortSignal | undefined

    const mount = () =>
      createRoot((dispose) => ({
        dispose,
        attachments: createComposerAttachments({
          capture: () => ({ ...prompt.capture, scope: unwrap(draft.state.store[0]()) }),
          editor: () => document.createElement("div"),
          focusEditor() {},
          addPart: () => false,
          setDraggingType() {},
          directory: () => "C:/repo",
          destination: () => ({
            input: { image: false, pdf: false },
            local: false,
            upload: (_file, _report, abort) => {
              signal = abort

              return new Promise<string>(() => {})
            },
          }),
          isDialogActive: () => false,
          duplicate() {},
          onError() {},
          onUploadError() {},
        }),
      }))

    const first = mount()
    await first.attachments.addAttachments([new File([new Uint8Array([0, 1, 2])], "data.bin")])
    first.dispose()

    const second = mount()
    expect(second.attachments.pending().map((upload) => upload.filename)).toEqual(["data.bin"])

    draft.dispose()
    expect(second.attachments.pending()).toEqual([])
    expect(signal?.aborted).toBe(true)
    second.dispose()
  })
})
