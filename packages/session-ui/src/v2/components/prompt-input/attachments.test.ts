import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptInputV2Attachments } from "./attachments"
import type { PromptInputV2Prompt } from "./types"

test("reports attachment persistence failures from dropped files", async () => {
  const failure = new Error("failed to persist attachment")
  const errors: unknown[] = []
  let prompt: PromptInputV2Prompt = []
  const result = createRoot((dispose) => ({
    attachments: createPromptInputV2Attachments({
      capture: () => ({
        current: () => prompt,
        cursor: () => 0,
        set: (next) => {
          prompt = next
        },
      }),
      editor: () => ({}) as HTMLElement,
      focusEditor() {},
      addPart: () => false,
      setDraggingType() {},
      directory: () => "/tmp",
      isDialogActive: () => false,
      warn() {},
      duplicate() {},
      onError: (error) => errors.push(error),
      store: async () => {
        throw failure
      },
    }),
    dispose,
  }))

  await result.attachments.handleDrop({
    preventDefault() {},
    dataTransfer: {
      getData: () => "",
      files: [new File(["image"], "image.png", { type: "image/png" })],
    },
  } as unknown as DragEvent)

  expect(errors).toEqual([failure])
  expect(prompt).toEqual([])
  result.dispose()
})
