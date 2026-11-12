import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createComposerAttachments } from "@/composer/attachments/attachments"
import type { ComposerPrompt } from "@/composer/types"

const failure = new Error("ENOSPC: no space left on device")

const unhandled: unknown[] = []

const recordUnhandled: NodeJS.UnhandledRejectionListener = (reason) => {
  unhandled.push(reason)
}

beforeEach(() => {
  unhandled.length = 0
  process.on("unhandledRejection", recordUnhandled)
})

afterEach(() => {
  process.off("unhandledRejection", recordUnhandled)
})

function setup(options: { readClipboardImage?: () => Promise<File | null> } = {}) {
  const [store, setStore] = createStore<{ prompt: ComposerPrompt; cursor: number }>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
  })

  const errors: unknown[] = []

  let attachments!: ReturnType<typeof createComposerAttachments>

  const dispose = render(() => {
    attachments = createComposerAttachments({
      capture: () => ({
        current: () => store.prompt,
        cursor: () => store.cursor,
        set: (prompt, cursor = store.cursor) => setStore({ prompt, cursor }),
      }),
      editor: () => document.createElement("div"),
      focusEditor() {},
      addPart: () => false,
      setDraggingType() {},
      directory: () => "/repo",
      destination: () => ({
        input: { image: true, pdf: true },
        local: false,
        upload: () => Promise.reject(new Error("inline images must not upload")),
      }),
      isDialogActive: () => false,
      duplicate() {},
      onError: (error) => errors.push(error),
      onUploadError: (error) => errors.push(error),
      store: () => Promise.reject(failure),
      readClipboardImage: options.readClipboardImage,
    })

    return null
  }, document.createElement("div"))

  return { attachments, errors, store, dispose }
}

const image = (name = "image.png") => new File([name], name, { type: "image/png" })

function transfer(file?: File) {
  const data = new DataTransfer()

  if (file) data.items.add(file)

  return data
}

// Lets fire-and-forget work settle and any unhandled rejection surface.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("Composer attachment persistence failures", () => {
  test("adding files reports a failed blob write through onError", async () => {
    const { attachments, errors, store, dispose } = setup()

    void attachments.addAttachments([image()])
    await settle()

    expect(errors).toEqual([failure])
    expect(unhandled).toEqual([])
    expect(store.prompt.some((part) => part.type === "image")).toBe(false)
    dispose()
  })

  test("pasting an image reports a failed blob write through onError", async () => {
    const { attachments, errors, dispose } = setup()
    const event = new ClipboardEvent("paste", { cancelable: true, clipboardData: transfer(image()) })

    void attachments.handlePaste(event)
    await settle()

    expect(errors).toEqual([failure])
    expect(unhandled).toEqual([])
    dispose()
  })

  test("dropping an image on the document reports a failed blob write through onError", async () => {
    const { errors, dispose } = setup()
    await Promise.resolve()
    const event = new DragEvent("drop", { cancelable: true })
    // happy-dom ignores the dataTransfer init option.
    Object.defineProperty(event, "dataTransfer", { value: transfer(image()) })

    document.dispatchEvent(event)
    await settle()

    expect(errors).toEqual([failure])
    expect(unhandled).toEqual([])
    dispose()
  })

  test("pasting a native clipboard image reports a failed blob write through onError", async () => {
    const { attachments, errors, dispose } = setup({ readClipboardImage: async () => image() })
    const event = new ClipboardEvent("paste", { cancelable: true, clipboardData: transfer() })

    void attachments.handlePaste(event)
    await settle()

    expect(errors).toEqual([failure])
    expect(unhandled).toEqual([])
    dispose()
  })

  test("a failed batch reports through onError once", async () => {
    const { attachments, errors, dispose } = setup()

    const added = await attachments.addAttachments([image("first.png"), image("second.png")])

    expect(added).toBe(false)
    expect(errors).toEqual([failure])
    expect(unhandled).toEqual([])
    dispose()
  })
})
