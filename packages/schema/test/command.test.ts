import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Command } from "../src/command.js"

test("command wire metadata is optional and survives encoding for built-ins", () => {
  const decode = Schema.decodeUnknownSync(Command.Info)
  const encode = Schema.encodeSync(Command.Info)
  expect(encode(decode({ name: "init", source: "builtin" }))).toEqual({ name: "init", source: "builtin" })
  expect(encode(decode({ name: "init" }))).toEqual({ name: "init" })
  expect(encode(Command.Info.make({ name: "init", source: undefined }))).toEqual({ name: "init" })
})
