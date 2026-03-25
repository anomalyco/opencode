import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { mockTuiRuntime } from "../../fixture/tui-runtime"
import { createTuiPluginApi } from "../../fixture/tui-plugin"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("exposes expanded plugin state facade", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginPath = path.join(dir, "state-plugin.ts")
      const pluginSpec = pathToFileURL(pluginPath).href
      const marker = path.join(dir, "state-marker.json")

      await Bun.write(
        pluginPath,
        `export default {
  tui: async (api, options) => {
    const row = {
      path_directory: api.state.path.directory,
      path_config: api.state.path.config,
      vcs_branch: api.state.vcs?.branch ?? null,
      workspace_count: api.state.workspace.list().length,
      workspace_hit: api.state.workspace.get(options.workspace_id)?.id ?? null,
      diff_count: api.state.session.diff(options.session_id).length,
      todo_count: api.state.session.todo(options.session_id).length,
      status: api.state.session.status(options.session_id)?.type ?? null,
      permission_count: api.state.session.permission(options.session_id).length,
      question_count: api.state.session.question(options.session_id).length,
      part_count: api.state.part(options.message_id).length,
    }
    await Bun.write(options.marker, JSON.stringify(row))
  },
}
`,
      )

      return {
        marker,
        pluginSpec,
      }
    },
  })

  const restore = mockTuiRuntime(tmp.path, [
    [
      tmp.extra.pluginSpec,
      {
        marker: tmp.extra.marker,
        session_id: "ses_1",
        message_id: "msg_1",
        workspace_id: "ws_1",
      },
    ],
  ])

  try {
    await TuiPluginRuntime.init(
      createTuiPluginApi({
        state: {
          path: {
            state: "/tmp/project/.opencode/state",
            config: "/tmp/project/.opencode/config",
            worktree: "/tmp/project",
            directory: "/tmp/project",
          },
          vcs: {
            branch: "dev",
          },
          workspace: {
            list() {
              return [
                {
                  id: "ws_1",
                  type: "worktree",
                  branch: "dev",
                  name: "Workspace 1",
                  directory: "/tmp/ws_1",
                  extra: null,
                  projectID: "project_1",
                },
              ]
            },
            get(workspaceID) {
              if (workspaceID !== "ws_1") return
              return {
                id: "ws_1",
                type: "worktree",
                branch: "dev",
                name: "Workspace 1",
                directory: "/tmp/ws_1",
                extra: null,
                projectID: "project_1",
              }
            },
          },
          session: {
            diff(sessionID) {
              if (sessionID !== "ses_1") return []
              return [{ file: "src/app.ts", additions: 2, deletions: 1 }]
            },
            todo(sessionID) {
              if (sessionID !== "ses_1") return []
              return [{ content: "ship", status: "pending" }]
            },
            status(sessionID) {
              if (sessionID !== "ses_1") return
              return { type: "idle" }
            },
          },
        },
      }),
    )

    const row = JSON.parse(await fs.readFile(tmp.extra.marker, "utf8")) as Record<string, unknown>
    expect(row.path_directory).toBe("/tmp/project")
    expect(row.path_config).toBe("/tmp/project/.opencode/config")
    expect(row.vcs_branch).toBe("dev")
    expect(row.workspace_count).toBe(1)
    expect(row.workspace_hit).toBe("ws_1")
    expect(row.diff_count).toBe(1)
    expect(row.todo_count).toBe(1)
    expect(row.status).toBe("idle")
    expect(row.permission_count).toBe(0)
    expect(row.question_count).toBe(0)
    expect(row.part_count).toBe(0)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})
