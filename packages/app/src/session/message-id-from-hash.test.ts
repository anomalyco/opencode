import { expect, test } from "bun:test"
import { messageIdFromHash } from "./message-id-from-hash"

test.each([
  ["#message-abc123", "abc123"],
  ["message-42", "42"],
  ["#review-panel", undefined],
])("reads the message ID from %s", (hash, id) => {
  expect(messageIdFromHash(hash)).toBe(id)
})
