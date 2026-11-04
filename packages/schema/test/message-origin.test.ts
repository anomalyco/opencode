import { expect, test } from "bun:test"
import { Schema } from "effect"
import { MessageOrigin } from "../src/message-origin.js"

const decode = Schema.decodeUnknownSync(MessageOrigin.Info)
const decodeMetadata = Schema.decodeUnknownSync(MessageOrigin.Metadata)

test("an origin is from a machine or via a surface, with an optional actor", () => {
  for (const origin of [
    { from: "session:ses_1" },
    { from: "schedule:sch_1" },
    { from: "tool:ios-train", actor: "agent:a1" },
    { via: "voice:ios" },
    { via: "seer" },
    { via: "seer", actor: "slack:U123" },
  ])
    expect(decode(origin)).toEqual(origin)
})

test("from and via are mutually exclusive, and one of them is required", () => {
  expect(() => decode({ from: "session:ses_1", via: "voice:ios" })).toThrow()
  expect(() => decode({ actor: "slack:U1" })).toThrow()
  expect(() => decode({})).toThrow()
})

test("values are one trimmed, non-empty line of at most 200 characters", () => {
  for (const value of ["", " seer", "seer ", "voice:\nios", "voice:\rios", "a\u2028b", "x".repeat(201)]) {
    expect(() => decode({ from: value })).toThrow()
    expect(() => decode({ via: value })).toThrow()
    expect(() => decode({ via: "seer", actor: value })).toThrow()
  }
  expect(decode({ from: "x".repeat(200) })).toEqual({ from: "x".repeat(200) })
})

test("metadata keeps other keys and checks only the origin", () => {
  expect(decodeMetadata({ source: "api", nested: { a: 1 } })).toEqual({ source: "api", nested: { a: 1 } })
  expect(decodeMetadata({ [MessageOrigin.Key]: { via: "voice:ios" }, source: "api" })).toEqual({
    [MessageOrigin.Key]: { via: "voice:ios" },
    source: "api",
  })
  expect(Schema.encodeSync(MessageOrigin.Metadata)({ [MessageOrigin.Key]: { via: "seer", actor: undefined } })).toEqual(
    { [MessageOrigin.Key]: { via: "seer" } },
  )
  expect(Schema.encodeSync(MessageOrigin.Metadata)({ [MessageOrigin.Key]: undefined, source: "api" })).toEqual({
    source: "api",
  })
  expect(() => decodeMetadata({ [MessageOrigin.Key]: { kind: "session", sessionID: "ses_1" } })).toThrow()
  expect(() => decodeMetadata({ [MessageOrigin.Key]: { from: "a", via: "b" } })).toThrow()
})
