import { expect, test } from "bun:test"
import { rejectLargePromptPaste } from "./interaction"

test("rejects the large-paste regression fixture before touching the editor DOM", () => {
  let notified = 0
  let prevented = false
  const event = {
    preventDefault: () => {
      prevented = true
    },
  } as unknown as ClipboardEvent
  const text = Array.from({ length: 1400 }, () => "1".repeat(120)).join("\n")

  const rejected = rejectLargePromptPaste(event, text, () => {
    notified += 1
  })

  expect(rejected).toBe(true)
  expect(prevented).toBe(true)
  expect(notified).toBe(1)
})
