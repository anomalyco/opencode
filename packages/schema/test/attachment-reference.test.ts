import { expect, test } from "bun:test"
import { AttachmentReference } from "../src/attachment-reference.js"

const file = (uri: string) =>
  ({ name: "image.png", mime: "image/png", data: "", source: { type: "uri", uri } }) as const

test("parses references for any Session.ID shape", () => {
  for (const sessionID of ["ses_test", "ses01J"]) {
    const reference = file(AttachmentReference.make(sessionID, "msg_a", 2))

    expect(AttachmentReference.is(reference)).toBe(true)
    expect(AttachmentReference.parse(reference)).toEqual({ sessionID, messageID: "msg_a", index: 2 })
  }
  expect(AttachmentReference.parse(file("file:///image.png"))).toBeUndefined()
  expect(() => AttachmentReference.parse(file("opencode-attachment:prj_a/msg_a/0"))).toThrow()
})
