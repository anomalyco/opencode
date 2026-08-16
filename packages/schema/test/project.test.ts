import { expect, test } from "bun:test"
import { Project } from "../src/project.js"
import { Schema } from "effect"

test("project update omits undefined metadata", () => {
  expect(
    Schema.encodeSync(Project.UpdateInput)({
      name: undefined,
      icon: { url: undefined, override: "data:image/png;base64,updated", color: undefined },
      commands: { start: undefined },
    }),
  ).toEqual({
    icon: { override: "data:image/png;base64,updated" },
    commands: {},
  })
})
