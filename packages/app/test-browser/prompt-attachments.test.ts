import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptAttachmentsCore } from "@/components/prompt-input/attachments"
import { createPromptState } from "@/context/prompt"
import { createPromptInputV2Attachments } from "../../session-ui/src/v2/components/prompt-input/attachments"
import { createPromptInputV2Controller } from "../../session-ui/src/v2/components/prompt-input/interaction"
import type { PromptInputV2PersistedState, PromptInputV2Prompt } from "../../session-ui/src/v2/components/prompt-input/types"

describe("prompt attachment session ownership", () => {
  test("adds an asynchronously read image to the session where the read started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
      })
      const pending = attachments.addAttachment(new File([new Uint8Array(1024 * 1024)], "a.png", { type: "image/png" }))

      active = "B"
      await pending

      expect(images(sessions.A)).toHaveLength(1)
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })

  test("finishes the captured attachment after the active editor is removed", async () => {
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      let editor: HTMLDivElement | undefined = document.createElement("div")
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => editor,
      })
      const pending = attachments.addAttachment(new File([new Uint8Array(1024 * 1024)], "a.png", { type: "image/png" }))

      editor = undefined
      await pending

      expect(images(prompt)).toHaveLength(1)
      dispose()
    })
  })

  test("keeps every file in a batch on the session where the batch started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
      })
      const pending = attachments.addAttachments([
        new File([new Uint8Array(1024 * 1024)], "first.png", { type: "image/png" }),
        new File([new Uint8Array(1024 * 1024)], "second.png", { type: "image/png" }),
      ])

      active = "B"
      await pending

      expect(images(sessions.A)).toHaveLength(2)
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })

  test("keeps a delayed native clipboard image on the session where paste started", async () => {
    await createRoot(async (dispose) => {
      const sessions = { A: createPromptState(), B: createPromptState() }
      const read = Promise.withResolvers<File | null>()
      let active: "A" | "B" = "A"
      const attachments = createPromptAttachmentsCore({
        capture: () => sessions[active].capture(),
        editor: () => document.createElement("div"),
      })
      const pending = attachments.addClipboardAttachment(read.promise)

      active = "B"
      read.resolve(new File([new Uint8Array(1024 * 1024)], "clipboard.png", { type: "image/png" }))
      await pending

      expect(images(sessions.A)).toHaveLength(1)
      expect(images(sessions.B)).toHaveLength(0)
      dispose()
    })
  })
})

test("rejects a duplicate native clipboard attachment in the V2 prompt store", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicate = Promise.withResolvers<void>()
    const files = [
      new File(["hello"], "clipboard-1.txt", { type: "text/plain" }),
      new File(["hello"], "clipboard-2.txt", { type: "text/plain" }),
    ]
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: duplicate.resolve,
      onError: () => undefined,
      readClipboardImage: async () => files.shift() ?? null,
    })
    const event = {
      clipboardData: { items: [], getData: () => "" },
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as ClipboardEvent

    await attachments.handlePaste(event)
    await attachments.handlePaste(event)
    await duplicate.promise

    expect(state.prompt).toHaveLength(1)
    dispose()
  })
})

test("rejects desktop duplicates and keeps changed files in the V2 prompt store", async () => {
  await createRoot(async (dispose) => {
    const [state, setState] = createStore({ prompt: [] as PromptInputV2Prompt })
    const duplicates: string[] = []
    const attachments = createPromptInputV2Attachments({
      capture: () => ({
        current: () => state.prompt,
        cursor: () => 0,
        set: (prompt) => setState("prompt", prompt),
      }),
      editor: () => document.createElement("div"),
      focusEditor: () => undefined,
      addPart: () => false,
      setDraggingType: () => undefined,
      directory: () => "/",
      isDialogActive: () => false,
      warn: () => undefined,
      duplicate: () => duplicates.push("duplicate"),
      onError: () => undefined,
      getPathForFile: (file) => (file.name === "browser.txt" ? "" : `/tmp/${file.name}`),
    })
    const first = new File(["first"], "a.txt", { type: "text/plain" })
    const second = new File(["second"], "b.txt", { type: "text/plain" })

    await attachments.addAttachments([first, second])
    await attachments.addAttachments([first, second])
    expect(state.prompt).toHaveLength(2)
    expect(duplicates).toEqual(["duplicate", "duplicate"])

    await attachments.addAttachments([new File(["edited"], "a.txt", { type: "text/plain" })])
    expect(state.prompt).toHaveLength(3)

    await attachments.addAttachments([
      new File(["same"], "browser.txt", { type: "text/plain" }),
      new File(["same"], "browser.txt", { type: "text/plain" }),
    ])
    expect(state.prompt).toHaveLength(4)
    expect(duplicates).toHaveLength(3)
    dispose()
  })
})

test("rejects the large-paste regression fixture before editor insertion", () => {
  createRoot((dispose) => {
    const [state, setState] = createStore<PromptInputV2PersistedState>({
      prompt: [{ type: "text" as const, content: "", start: 0, end: 0 }],
      cursor: 0,
      context: { items: [] },
    })
    let notified = 0
    let prevented = false
    let execCommandCalls = 0
    const editor = document.createElement("div")
    editor.textContent = "existing"
    document.body.append(editor)
    const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand")
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        execCommandCalls += 1
        return true
      },
    })
    const controller = createPromptInputV2Controller({
      store: [state, setState],
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      view: {
        submit: { stopping: () => false, onSubmit: () => undefined, onStop: () => undefined },
        onLargePaste: () => {
          notified += 1
        },
      },
    })
    const text = Array.from({ length: 1400 }, () => "1".repeat(120)).join("\n")
    const event = {
      clipboardData: { items: [], getData: () => text },
      preventDefault: () => {
        prevented = true
      },
    } as unknown as ClipboardEvent

    try {
      controller.setEditor(editor)
      controller.onPaste(event)

      expect(prevented).toBe(true)
      expect(notified).toBe(1)
      expect(execCommandCalls).toBe(0)
      expect(editor.textContent).toBe("existing")
      expect(controller.value()).toBe("")
    } finally {
      if (descriptor) Object.defineProperty(document, "execCommand", descriptor)
      else Reflect.deleteProperty(document, "execCommand")
      editor.remove()
      dispose()
    }
  })
})

function images(prompt: ReturnType<typeof createPromptState>) {
  return prompt.current().filter((part) => part.type === "image")
}
