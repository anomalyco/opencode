import { describe, expect, test } from "bun:test"
import { parseClientSlashCommand } from "./client-slash-command"

const options = [
  { id: "session.btw", trigger: "btw", arguments: true, type: "builtin" as const },
  { id: "custom.btw", trigger: "custom", type: "custom" as const },
  { id: "model.choose", trigger: "model", type: "builtin" as const },
]

describe("parseClientSlashCommand", () => {
  test("parses inline and multiline arguments", () => {
    expect(parseClientSlashCommand(options, "/btw why this approach?")).toEqual({
      id: "session.btw",
      input: "why this approach?",
    })
    expect(parseClientSlashCommand(options, "/btw\nwhy this approach?")).toEqual({
      id: "session.btw",
      input: "why this approach?",
    })
  })

  test("accepts a bare argument command", () => {
    expect(parseClientSlashCommand(options, "/btw")).toEqual({ id: "session.btw", input: "" })
  })

  test("rejects prefixes, custom commands, and ordinary slash commands", () => {
    expect(parseClientSlashCommand(options, "/btwx nope")).toBeUndefined()
    expect(parseClientSlashCommand(options, "/custom nope")).toBeUndefined()
    expect(parseClientSlashCommand(options, "/model opus")).toBeUndefined()
    expect(parseClientSlashCommand(options, "ask /btw later")).toBeUndefined()
  })
})
