import { expect, test } from "bun:test"
import { parseSessionMention, serializeSessionMention, sessionMentions } from "./session-mention.js"

const id = "ses_0123456789abcdefghijklmnop"

test("session tokens round-trip independently of the title", () => {
  expect(serializeSessionMention({ id })).toBe(`@session:${id}`)
  expect(parseSessionMention(`@session:${id}`)).toEqual({ id })
  expect(parseSessionMention(id)).toEqual({ id })
  expect(sessionMentions(`See @session:${id}, then ${id}.`).map((match) => match.id)).toEqual([id, id])
})

test.each(["ses_123", `@session:${id}extra`, `x${id}`, `${id}/path`, `https://host/${id}`, `@other:${id}`, `${id}_x`])(
  "does not parse malformed or embedded IDs: %s",
  (text) => {
    expect(parseSessionMention(text)).toBeUndefined()
    expect(sessionMentions(text)).toEqual([])
  },
)
