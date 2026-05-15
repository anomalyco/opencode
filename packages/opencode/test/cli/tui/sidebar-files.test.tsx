/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import SidebarFiles from "@/cli/cmd/tui/feature-plugins/sidebar/files"
import { createTuiPluginApi } from "../../fixture/tui-plugin"

test("sidebar files renders aggregate additions and deletions in the header", async () => {
  let sidebarContent: TuiSlotPlugin["slots"]["sidebar_content"]
  const base = createTuiPluginApi({
    state: {
      session: {
        diff(sessionID) {
          if (sessionID !== "ses_test") return []
          return [
            { file: "src/one.ts", additions: 2, deletions: 1 },
            { file: "src/two.ts", additions: 4, deletions: 0 },
            { file: "src/three.ts", additions: 0, deletions: 3 },
          ]
        },
      },
    },
  })
  const api: TuiPluginApi = {
    ...base,
    slots: {
      register(plugin: TuiSlotPlugin) {
        sidebarContent = plugin.slots.sidebar_content
        return "internal:sidebar-files"
      },
    },
  }

  await SidebarFiles.tui(api, undefined, {
    id: "internal:sidebar-files",
    source: "internal",
    spec: "internal:sidebar-files",
    target: "internal:sidebar-files",
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "internal",
    state: "same",
  })

  if (!sidebarContent) throw new Error("sidebar files slot was not registered")
  const renderSidebarContent = sidebarContent

  const app = await testRender(
    () => (
      <box width={80} height={8}>
        {renderSidebarContent({ theme: api.theme }, { session_id: "ses_test" })}
      </box>
    ),
    {
      width: 80,
      height: 8,
    },
  )

  try {
    await app.renderOnce()

    const frame = app.captureCharFrame().replace(/ +/g, " ")
    expect(frame).toContain("Modified Files +6 -4")
    expect(frame).toContain("src/one.ts")
    expect(frame).toContain("+2")
    expect(frame).toContain("-1")
  } finally {
    app.renderer.destroy()
  }
})
