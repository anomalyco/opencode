import { expect, test } from "bun:test"
import { DateTime } from "effect"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

const created = DateTime.makeUnsafe(0)
const userEntry = (seq: number, text: string) => ({
  seq,
  message: new SessionMessage.User({
    id: SessionMessage.ID.make(`msg_${seq}`),
    type: "user",
    text,
    time: { created },
  }),
})

test("select does not duplicate the boundary message into head", () => {
  // serialize() renders a user message as `[User]: <text>`; Token.estimate is
  // round(length / 4). With tokens=5: the small message (estimate 3) fits, then
  // the big message overflows and is split mid-message. The boundary message
  // must appear in head ONLY as the truncated prefix — never in full.
  const big = "A".repeat(40)
  const entries = [userEntry(0, big), userEntry(1, "BBBB")]

  const result = SessionCompaction.select(entries, 5)

  expect(result).toBeDefined()
  // head is just the prefix slice, not the full boundary message + its prefix.
  expect(result!.head).toBe(`[User]: ${"A".repeat(32)}`)
  expect(result!.recent).toBe(`${"A".repeat(8)}\n\n[User]: BBBB`)
  // Regression guard for the duplication bug (head once contained the full
  // 40-char message AND its 32-char prefix copy):
  expect(result!.head).not.toContain("A".repeat(40))
  expect(result!.head.split("[User]:").length - 1).toBe(1)
})

test("select keeps everything in recent when the whole conversation fits", () => {
  const entries = [userEntry(0, "first"), userEntry(1, "second")]

  const result = SessionCompaction.select(entries, 1000)

  expect(result).toBeDefined()
  expect(result!.head).toBe("")
  expect(result!.recent).toBe("[User]: first\n\n[User]: second")
})
