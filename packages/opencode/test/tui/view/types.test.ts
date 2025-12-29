// packages/opencode/test/tui/view/types.test.ts
import { describe, expect, test } from "bun:test"
import { View } from "../../../src/cli/cmd/tui/view/types"

describe("View.Tree", () => {
  test("creates tree view data", () => {
    const tree = View.Tree.create({
      id: "session-tree",
      title: "Sessions",
      nodes: [
        {
          id: "session-1",
          label: "Chat about TypeScript",
          icon: "chat",
          children: [],
          expanded: false,
        },
      ],
    })
    expect(tree.type).toBe("tree")
    expect(tree.nodes).toHaveLength(1)
  })

  test("validates tree node schema", () => {
    const result = View.Tree.Node.safeParse({
      id: "node-1",
      label: "Test Node",
      children: [],
    })
    expect(result.success).toBe(true)
  })
})

describe("View.List", () => {
  test("creates list view data", () => {
    const list = View.List.create({
      id: "command-palette",
      title: "Commands",
      items: [
        { id: "cmd-1", label: "New Session", description: "Create a new chat session" },
        { id: "cmd-2", label: "Switch Model", description: "Change the AI model" },
      ],
      searchable: true,
    })
    expect(list.type).toBe("list")
    expect(list.items).toHaveLength(2)
    expect(list.searchable).toBe(true)
  })
})

describe("View.Text", () => {
  test("creates text view data", () => {
    const text = View.Text.create({
      id: "help-view",
      title: "Help",
      content: "# OpenCode Help\n\nWelcome to OpenCode!",
      filetype: "markdown",
    })
    expect(text.type).toBe("text")
    expect(text.filetype).toBe("markdown")
  })
})

describe("View.Form", () => {
  test("creates form view data", () => {
    const form = View.Form.create({
      id: "settings",
      title: "Settings",
      fields: [
        { id: "theme", type: "select", label: "Theme", options: ["dark", "light"] },
        { id: "autosave", type: "toggle", label: "Auto-save", value: true },
      ],
    })
    expect(form.type).toBe("form")
    expect(form.fields).toHaveLength(2)
  })
})
