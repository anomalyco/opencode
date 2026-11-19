/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import { busyCounts, busyTab, createComposerTabs } from "../../src/routes/session/composer/tabs"

async function setup(defaultTab?: string) {
  const [open, setOpen] = createSignal(false)
  let tabs!: ReturnType<typeof createComposerTabs>
  const app = await testRender(
    () => {
      tabs = createComposerTabs({ open, defaultTab: () => defaultTab })
      return <text>{tabs.active()}</text>
    },
    { width: 20, height: 1 },
  )
  return { app, tabs, setOpen }
}

test("composer tabs keep a canonical order and the active tab while Scripts comes and goes", async () => {
  const { app, tabs, setOpen } = await setup()
  try {
    tabs.register({ id: "terminals", label: "Terminals" })
    tabs.register({ id: "subagents", label: "Subagents" })
    tabs.register({ id: "shell", label: "Shell" })
    setOpen(true)
    expect(tabs.active()).toBe("subagents")
    tabs.setActive("shell")

    const remove = tabs.register({ id: "scripts", label: "Scripts" })
    expect(tabs.list().map((tab) => tab.id)).toEqual(["subagents", "shell", "scripts", "terminals"])
    expect(tabs.active()).toBe("shell")
    remove()
    expect(tabs.active()).toBe("shell")

    const again = tabs.register({ id: "scripts", label: "Scripts" })
    tabs.setActive("scripts")
    again()
    expect(tabs.active()).toBe("subagents")
  } finally {
    app.renderer.destroy()
  }
})

test("composer tabs open on the requested tab", async () => {
  const { app, tabs, setOpen } = await setup("scripts")
  try {
    tabs.register({ id: "subagents", label: "Subagents" })
    tabs.register({ id: "scripts", label: "Scripts" })
    setOpen(true)
    expect(tabs.active()).toBe("scripts")
  } finally {
    app.renderer.destroy()
  }
})

test("composer tabs switch to the requested tab once it registers, until the user picks one", async () => {
  const { app, tabs, setOpen } = await setup("shell")
  try {
    tabs.register({ id: "subagents", label: "Subagents" })
    setOpen(true)
    expect(tabs.active()).toBe("subagents")
    tabs.register({ id: "shell", label: "Shell" })
    expect(tabs.active()).toBe("shell")
    tabs.register({ id: "scripts", label: "Scripts" })
    expect(tabs.active()).toBe("shell")
    tabs.setActive("subagents")
    tabs.register({ id: "terminals", label: "Terminals" })
    expect(tabs.active()).toBe("subagents")
  } finally {
    app.renderer.destroy()
  }
})

test("the picker opens on the first busy tab, else Subagents", () => {
  const counts = (jobs: unknown[], shells: unknown[]) =>
    busyCounts({
      data: {
        job: { list: () => jobs },
        session: { family: () => ["ses_root", "ses_child"], status: () => "idle", get: () => undefined },
        shell: { list: () => shells },
      } as unknown as Plugin.Context["data"],
      sessionID: "ses_root",
      location: { directory: "/project" },
    })

  const script = counts([{ id: "job_1", kind: "codemode", sessionID: "ses_root" }], [])
  expect(script).toEqual({ scripts: 1, subagents: 0, shells: 0 })
  expect(busyTab(script)).toBe("scripts")

  const shell = counts([], [{ metadata: { sessionID: "ses_root" } }, { metadata: { sessionID: "ses_other" } }])
  expect(shell).toEqual({ scripts: 0, subagents: 0, shells: 1 })
  expect(busyTab(shell)).toBe("shell")

  expect(busyTab(counts([], []))).toBe("subagents")
})
