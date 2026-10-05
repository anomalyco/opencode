/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import sidebarGit from "../../src/feature-plugins/sidebar/git"
import { createBuiltinPlugins } from "../../src/feature-plugins/builtins"
import { createTuiPluginApi } from "../fixture/tui-plugin"

type SidebarRender = (ctx: unknown, props: { session_id: string }) => JSX.Element

const pluginMeta = {
  id: "sidebar-git",
  source: "internal",
  spec: "sidebar-git",
  target: "sidebar-git",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

async function renderSidebarGit(input: { files?: unknown[]; info?: unknown; fail?: boolean }) {
  let render: SidebarRender | undefined
  const client = {
    vcs: {
      status: async () => {
        if (input.fail) throw new Error("vcs status failed")
        return { data: input.files ?? [] }
      },
      get: async () => {
        if (input.fail) throw new Error("vcs get failed")
        return { data: input.info }
      },
    },
  } as unknown as TuiPluginApi["client"]
  const base = createTuiPluginApi({
    client,
    event: { on: () => () => {} } as unknown as TuiPluginApi["event"],
    state: {
      session: { get: (() => ({ directory: "/work/repo" })) as unknown as TuiPluginApi["state"]["session"]["get"] },
    },
  })
  const api = {
    ...base,
    slots: {
      register(slot: TuiSlotPlugin) {
        render = slot.slots?.sidebar_content as unknown as SidebarRender
        return "sidebar-git-test"
      },
    } as unknown as TuiPluginApi["slots"],
  } satisfies TuiPluginApi

  await sidebarGit.tui(api, undefined, pluginMeta)

  const app = await testRender(() => render!({}, { session_id: "session-1" }), { width: 40, height: 8 })
  return { app }
}

test("is registered as an enabled builtin plugin", () => {
  const plugin = createBuiltinPlugins({ experimentalEventSystem: false }).find(
    (item) => item.id === "internal:sidebar-git",
  )
  expect(plugin).toBeDefined()
  expect(plugin?.enabled ?? true).toBe(true)
})

test("shows changed and untracked counts for the session directory", async () => {
  const { app } = await renderSidebarGit({
    files: [
      { file: "src/a.ts", additions: 12, deletions: 3, status: "modified", code: " M" },
      { file: "src/b.ts", additions: 5, deletions: 0, status: "added", code: "??" },
    ],
    info: { branch: "feature", default_branch: "dev", ahead: 2, behind: 1 },
  })

  try {
    await app.waitForFrame((frame) => frame.includes("Git"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("Git")
    expect(frame).toContain("2 changed")
    expect(frame).toContain("1 untracked")
    expect(frame).toContain("2 to push")
    expect(frame).toContain("1 to pull")
    expect(frame).toContain("+17")
    expect(frame).toContain("-3")
  } finally {
    app.renderer.destroy()
  }
})

test("stays hidden when the working tree is clean", async () => {
  const { app } = await renderSidebarGit({ files: [], info: { branch: "dev", default_branch: "dev" } })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Git")
  } finally {
    app.renderer.destroy()
  }
})

test("stays hidden when the vcs endpoints fail", async () => {
  const { app } = await renderSidebarGit({ fail: true })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Git")
  } finally {
    app.renderer.destroy()
  }
})
