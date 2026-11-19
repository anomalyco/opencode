/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { For } from "solid-js"
import { SidebarTodo } from "../../src/feature-plugins/sidebar/todo"
import type { Todo } from "../../src/util/todo"

function context(todos: Todo[]) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: { text: { base: color, muted: color, feedback: { warning: { base: color } } } },
    storage: { store: () => [{ open: true }, async () => {}] },
    data: {
      session: {
        get: () => ({}),
        message: {
          list: () => [
            {
              type: "assistant",
              content: [{ type: "tool", name: "todowrite", state: { status: "completed", input: { todos } } }],
            },
          ],
        },
      },
    },
  } as unknown as Context
}

const content = [
  "Review the sample output at several terminal widths and verify all displayed labels",
  "Check example descriptions for wrapping and maintain consistent section spacing",
  "Run the sample checks, inspect the terminal output, and document expected results",
  "Prepare a sample report with before and after captures; record the verification results",
]

test("sidebar preserves wrapped todo content and spacing before a growing section", async () => {
  const todos = content.map(
    (content, index): Todo => ({
      content,
      status: index === 0 ? "in_progress" : "pending",
    }),
  )
  const app = await testRender(
    () => (
      <box width={40} height={40} paddingLeft={2} paddingRight={2}>
        <scrollbox
          flexGrow={1}
          minHeight={0}
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <SidebarTodo context={context(todos)} sessionID="session" />
            <box flexGrow={1} flexShrink={1}>
              <box flexDirection="row">
                <text>Next section</text>
              </box>
              <scrollbox flexGrow={1} flexShrink={1}>
                <For each={Array.from({ length: 67 }, (_, index) => index)}>
                  {(index) => (
                    <box flexDirection="row">
                      <text>Item {index}</text>
                    </box>
                  )}
                </For>
              </scrollbox>
            </box>
          </box>
        </scrollbox>
      </box>
    ),
    { width: 40, height: 40 },
  )

  try {
    await app.renderOnce()
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trim())
    const next = rows.indexOf("Next section")
    expect(next).toBeGreaterThan(0)
    expect(rows[next - 1]).toBe("")
    expect(rows[next - 2]).not.toBe("")
    expect(
      rows
        .slice(1, next)
        .map((row) => row.replace(/^\[[^\]]+\]\s*/, ""))
        .join(" ")
        .replace(/\s+/g, ""),
    ).toBe(
      todos
        .map((todo) => todo.content)
        .join("")
        .replace(/\s+/g, ""),
    )
  } finally {
    app.renderer.destroy()
  }
})
