import { expect, test } from "bun:test"
import { render } from "solid-js/web"
import { createComposerAttachments } from "@/composer/attachments/attachments"

test("clears drag state on platform cancellation", async () => {
  let cancel = () => {}
  let subscribed = false
  let dragging: "image" | "@mention" | null = "image"
  const dispose = render(() => {
    createComposerAttachments({
      capture: () => ({ current: () => [], cursor: () => 0, set: () => {} }),
      editor: () => undefined,
      focusEditor: () => {},
      addPart: () => false,
      setDraggingType: (type) => (dragging = type),
      directory: () => "",
      isDialogActive: () => false,
      warn: () => {},
      duplicate: () => {},
      onError: () => {},
      onDragCancel: (callback) => {
        cancel = callback
        subscribed = true
        return () => (subscribed = false)
      },
    })
    return null
  }, document.createElement("div"))
  await Promise.resolve()

  cancel()

  expect(dragging).toBeNull()
  dispose()
  expect(subscribed).toBeFalse()
})
