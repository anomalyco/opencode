import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

type PromptStore = {
  current: () => []
  cursor: () => number
  set: (...args: unknown[]) => void
}

let prompt = {} as PromptStore
const toasts: Array<{ title?: string; description?: string }> = []

let createPromptAttachments: typeof import("./attachments").createPromptAttachments
let MAX_ATTACHMENT_BYTES = 0

beforeAll(async () => {
  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string, params?: { limit?: string }) => {
        if (key === "prompt.toast.attachmentTooLarge.title") return "Attachment too large"
        if (key === "prompt.toast.attachmentTooLarge.description") return `limit:${params?.limit ?? ""}`
        return key
      },
    }),
  }))
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (value: { title?: string; description?: string }) => {
      toasts.push(value)
    },
  }))
  const mod = await import("./attachments")
  createPromptAttachments = mod.createPromptAttachments
  MAX_ATTACHMENT_BYTES = mod.MAX_ATTACHMENT_BYTES
})

beforeEach(() => {
  toasts.length = 0
  prompt = {
    current: () => [],
    cursor: () => 0,
    set: () => undefined,
  }
})

describe("prompt attachments", () => {
  test("rejects oversized attachments before FileReader", async () => {
    const setCalls: unknown[][] = []
    prompt.set = (...args) => setCalls.push(args)

    const api = createRoot((dispose) => {
      const value = createPromptAttachments({
        editor: () => undefined,
        isFocused: () => true,
        isDialogActive: () => false,
        setDraggingType: () => undefined,
        focusEditor: () => undefined,
        addPart: () => false,
      })
      dispose()
      return value
    })

    await api.addImageAttachment({
      type: "application/pdf",
      size: MAX_ATTACHMENT_BYTES + 1,
      name: "huge.pdf",
    } as File)

    expect(setCalls).toHaveLength(0)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.title).toBe("Attachment too large")
    expect(toasts[0]?.description).toBe("limit:32 MiB")
  })
})
