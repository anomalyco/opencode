import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createComposerAttachments } from "@/composer/attachments/attachments"

type ComposerAttachmentsInput = Parameters<typeof createComposerAttachments>[0]

// A draft blob write that fails (disk full, or a destination the app cannot write) rejects the
// persistence call. The composer invokes the attachment operations without awaiting them, so the
// failure has to reach `onError` rather than escaping as an unhandled rejection.
function config(onError: ComposerAttachmentsInput["onError"]) {
  return {
    capture: () => ({ current: () => [], cursor: () => 0, set: () => {} }),
    editor: () => document.createElement("div"),
    focusEditor: () => {},
    addPart: () => false,
    setDraggingType: () => {},
    directory: () => "C:/repo",
    destination: () => ({
      input: { image: true, pdf: true },
      local: false,
      upload: () => Promise.reject(new Error("inline attachments must not upload")),
    }),
    isDialogActive: () => false,
    duplicate: () => {},
    onError,
    onUploadError: () => {},
    store: () => Promise.reject(new Error("draft store is not writable")),
  }
}

const image = () => new File(["image"], "image.png", { type: "image/png" })

test("reports a failed inline attachment to the composer", async () => {
  const errors: unknown[] = []

  await new Promise<void>((resolveTest, rejectTest) => {
    createRoot((dispose) => {
      const attachments = createComposerAttachments(config((error) => errors.push(error)))

      void attachments.addAttachments([image()]).then(() => {
        dispose()
        resolveTest()
      }, rejectTest)
    })
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
})

test("reports a failed dropped attachment instead of rejecting into the void", async () => {
  const failed = Promise.withResolvers<unknown>()

  const dispose = createRoot((dispose) => {
    createComposerAttachments(config(failed.resolve))

    return dispose
  })

  const event = new Event("drop", { cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: { files: [image()], getData: () => "" } })
  document.dispatchEvent(event)

  expect(await failed.promise).toBeInstanceOf(Error)
  dispose()
})
