import { describe, expect, test } from "bun:test"
import { parseClientSlashCommand } from "./client-slash-command"

const options = [
  { id: "session.btw", title: "Ask a side question", slash: "btw", slashArguments: true },
  { id: "disabled", title: "Disabled", slash: "off", slashArguments: true, disabled: true },
  { id: "model.choose", title: "Choose model", slash: "model" },
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

  test("rejects prefixes, disabled commands, and ordinary slash commands", () => {
    expect(parseClientSlashCommand(options, "/btwx nope")).toBeUndefined()
    expect(parseClientSlashCommand(options, "/off nope")).toBeUndefined()
    expect(parseClientSlashCommand(options, "/model opus")).toBeUndefined()
    expect(parseClientSlashCommand(options, "ask /btw later")).toBeUndefined()
  })
})
