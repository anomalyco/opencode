/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait, directory } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("session list query reflects the filter mode", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      // Default (hierarchical): current directory plus its descendants (relative path).
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("directory")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      // directory: exactly the current directory (isolates sibling worktrees).
      kv.set("session_filter_mode", "directory")
      await sync.session.refresh()
      expect(session.at(-1)?.searchParams.get("directory")).toBe(directory)
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()

      // project: every session in the project, regardless of directory.
      kv.set("session_filter_mode", "project")
      await sync.session.refresh()
      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("directory")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("honors the legacy session_directory_filter_enabled flag until a mode is set", async () => {
    await using tmp = await tmpdir()
    // A user who had explicitly disabled directory filtering (whole-project view).
    await Bun.write(`${tmp.path}/kv.json`, JSON.stringify({ session_directory_filter_enabled: false }))
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      // Legacy "disabled" maps to whole-project scope.
      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()

      // Choosing a mode takes precedence over the legacy flag.
      kv.set("session_filter_mode", "directory")
      await sync.session.refresh()
      expect(session.at(-1)?.searchParams.get("directory")).toBe(directory)
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })
})
