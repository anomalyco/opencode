import { expect, test } from "bun:test"
import { consumeEvidenceReveal, requestEvidenceReveal, revealPendingEvidence } from "./evidence-reveal"

test("reveals a requested message part once the destination session activates", () => {
  requestEvidenceReveal({ sessionID: "child", messageID: "msg-1", partID: "part-1" })
  const revealed: string[] = []
  const reveal = (messageID: string, partID?: string) => revealed.push(`${messageID}#${partID ?? ""}`)
  expect(revealPendingEvidence({ sessionID: "other", ready: true, reveal })).toBeUndefined()
  expect(revealPendingEvidence({ sessionID: "child", ready: false, reveal })).toBeUndefined()
  expect(revealed).toEqual([])
  expect(revealPendingEvidence({ sessionID: "child", ready: true, reveal })).toEqual({
    sessionID: "child",
    messageID: "msg-1",
    partID: "part-1",
  })
  expect(revealed).toEqual(["msg-1#part-1"])
  expect(revealPendingEvidence({ sessionID: "child", ready: true, reveal })).toBeUndefined()
  expect(revealed).toEqual(["msg-1#part-1"])
})

test("a later request for the same session replaces the pending target", () => {
  requestEvidenceReveal({ sessionID: "child", messageID: "msg-old" })
  requestEvidenceReveal({ sessionID: "child", messageID: "msg-new", partID: "part-new" })
  expect(consumeEvidenceReveal("child")).toEqual({ sessionID: "child", messageID: "msg-new", partID: "part-new" })
  expect(consumeEvidenceReveal("child")).toBeUndefined()
})
