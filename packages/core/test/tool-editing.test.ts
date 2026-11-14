import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { configuredEditing, editingResult, editingTools } from "@opencode/core/tool/editing"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"

const model = (id: string) => Model.Info.default(Provider.ID.make("test"), Model.ID.make(id))

const editing = (value: ConfigExperimental.Editing) => [
  new Document({
    type: "document",
    info: new Info({ experimental: new ConfigExperimental.Info({ editing: value }) }),
  }),
]

describe("ToolEditing", () => {
  test("keeps the model-dependent base", () => {
    expect([...editingTools(model("claude-sonnet-4"), undefined)]).toEqual(["edit", "write"])
    expect([...editingTools(model("gpt-5"), undefined)]).toEqual(["patch"])
  })

  test("applies add and remove deltas", () => {
    expect(
      [...editingTools(model("claude-sonnet-4"), { add: ["patch"], remove: ["edit", "write"] })],
    ).toEqual(["patch"])
  })

  test("uses the last matching rule over the top-level delta", () => {
    expect(
      [
        ...editingTools(model("claude-sonnet-4"), {
          add: ["edit", "write"],
          remove: ["patch"],
          rules: [{ match: "^test/claude", add: ["patch"], remove: ["edit", "write"] }],
        }),
      ],
    ).toEqual(["patch"])
  })

  test("reads editing per field when a later config sets another experimental option", () => {
    const entries = [
      ...editing({ add: ["patch"], remove: ["edit", "write"] }),
      new Document({
        type: "document",
        info: new Info({ experimental: new ConfigExperimental.Info({ subagent_depth: 2 }) }),
      }),
    ]
    expect(configuredEditing(entries)?.add).toEqual(["patch"])
  })

  test("defaults result_style to summary and lets a rule override it", () => {
    expect(editingResult(model("claude-sonnet-4"), undefined)).toBe("summary")
    expect(editingResult(model("claude-sonnet-4"), { result_style: "counts" })).toBe("counts")
    expect(
      editingResult(model("claude-sonnet-4"), {
        rules: [{ match: "^test/claude", result_style: "diff" }],
      }),
    ).toBe("diff")
  })
})
