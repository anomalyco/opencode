import { expect, test } from "bun:test"
import { parseClientSlashCommand, withoutShadowedClientCommands } from "./client-slash-command"

const options = [
  { id: "btw.ask", trigger: "btw", arguments: true, type: "builtin" as const },
  { id: "custom.btw", trigger: "custom", type: "custom" as const },
  { id: "model.choose", trigger: "model", type: "builtin" as const },
]

test.each([
  { text: "/btw why this approach?", result: { id: "btw.ask", input: "why this approach?" } },
  { text: "/btw\nwhy this approach?", result: { id: "btw.ask", input: "why this approach?" } },
  { text: "/btw", result: { id: "btw.ask", input: "" } },
  { text: "/btwx nope", result: undefined },
  { text: "/custom nope", result: undefined },
  { text: "/model opus", result: undefined },
  { text: "ask /btw later", result: undefined },
])("parses $text as a client argument command", (row) => {
  expect(parseClientSlashCommand(options, row.text)).toEqual(row.result)
})

test("a configured command hides a client argument command with the same name", () => {
  const list = withoutShadowedClientCommands([
    { id: "session.rename", trigger: "rename", arguments: true, type: "builtin" as const },
    { id: "custom.rename", trigger: "rename", type: "custom" as const },
    { id: "model.choose", trigger: "model", type: "builtin" as const },
    { id: "custom.model", trigger: "model", type: "custom" as const },
    { id: "btw.ask", trigger: "btw", arguments: true, type: "builtin" as const },
  ])

  expect(list.map((item) => item.id)).toEqual(["custom.rename", "model.choose", "custom.model", "btw.ask"])
  expect(parseClientSlashCommand(list, "/rename my workflow")).toBeUndefined()
})
