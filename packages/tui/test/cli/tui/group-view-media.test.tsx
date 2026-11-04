import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createStore } from "solid-js/store"
import type { SessionMessageAssistant } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { SessionGroupView } from "../../../src/routes/session/group-view"
import { createTimelineAnchors, groupID } from "../../../src/routes/session/anchors"
import { context } from "../../../src/routes/session/render-context"
import type { SessionGroup } from "../../../src/routes/session/grouping/session"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const time = { created: 0, completed: 2 }
const message: SessionMessageAssistant = {
  id: "a",
  type: "assistant",
  agent: "build",
  model: { providerID: "fixture", id: "fixture" },
  time,
  content: ["one", "two"].map((id) => ({
    type: "tool" as const,
    id,
    name: "shell",
    time,
    state: {
      status: "completed" as const,
      input: {},
      content: [{ type: "file" as const, uri: "data:image/png;base64,AAAA", mime: "image/png" }],
    },
  })),
}
const row: SessionGroup = {
  type: "group",
  kind: "activity",
  size: 2,
  completed: true,
  pending: [],
  children: ["one", "two"].map((partID) => ({
    type: "entry" as const,
    size: 1,
    entry: { type: "part" as const, ref: { messageID: "a", partID } },
  })),
}

test.each([true, false])("a collapsed low activity shows its tools' media with rich media %p", async (rich) => {
  const anchors = createTimelineAnchors()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const config = createTuiResolvedConfig({ animations: false, experimental: { "rich-media": rich } })
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <context.Provider
              value={{
                width: 60,
                terminal: { width: 60, height: 24 },
                sessionID: "fixture",
                anchors,
                groupExpanded: (id) => expanded[id] ?? false,
                setGroupExpanded: (id, value) => setExpanded(id, value),
                thinkingMode: () => "hide",
                markdownMode: () => "rendered",
                groupExploration: () => true,
                legacyTurns: () => false,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
              }}
            >
              <SessionGroupView
                row={row}
                message={() => message}
                images={(tools) => (
                  <text>Media of {tools.map((tool) => `${tool.messageID}/${tool.part.id}`).join(",")}</text>
                )}
                entry={(entry) => <text>{entry.type === "part" ? `Shell ${entry.ref.partID}` : ""}</text>}
              />
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 24 },
  )
  try {
    await app.renderOnce()
    const collapsed = app.captureCharFrame()
    expect(collapsed).toContain("2 commands")
    expect(collapsed.includes("Media of a/one,a/two")).toBe(rich)

    // Expanded, each tool shows its own media in its entry instead.
    setExpanded(groupID(row, 0)!, true)
    await app.renderOnce()
    const open = app.captureCharFrame()
    expect(open).toContain("Shell two")
    expect(open).not.toContain("Media of")
  } finally {
    app.renderer.destroy()
  }
})
