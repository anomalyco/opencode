/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { PermissionRequest } from "@opencode-ai/client"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function mount(root: string, width: number, save: string[], preview = true) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  const replies: unknown[] = []
  const transport = createFetch((url, request) => {
    if (url.pathname === "/api/session/ses_test/permission/per_test/reply")
      return request.json().then((reply) => {
        replies.push(reply)
        return new Response(null, { status: 204 })
      })
    return undefined
  }, createEventStream())
  const request = {
    id: "per_test",
    sessionID: "ses_test",
    action: "shell",
    resources: ["git status --short"],
    save,
  } satisfies PermissionRequest
  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider directory={root}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <ToastProvider>
                      <box height="100%" justifyContent="flex-end">
                        <PermissionPrompt request={request} />
                      </box>
                    </ToastProvider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 28, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Permission required"))
  if (preview) {
    app.mockInput.pressKey("ARROW_RIGHT")
    await app.waitForFrame((frame) => frame.includes("This will always allow"))
  }
  return { app, replies }
}

for (const width of [70, 110]) {
  for (const count of [8, 32, 100]) {
    test(`bounds ${count} permission patterns at ${width} columns and scrolls fullscreen`, async () => {
      await using tmp = await tmpdir()
      const patterns = Array.from({ length: count }, (_, i) => `check-package-${String(i + 1).padStart(3, "0")} *`)
      const { app, replies } = await mount(tmp.path, width, patterns)
      try {
        const limit = width < 80 ? 2 : 3
        expect(app.captureCharFrame()).toContain(`+${count - limit} more`)
        expect(app.captureCharFrame()).not.toContain(patterns[limit])
        expect(app.captureCharFrame()).toContain("Always allow")
        app.mockInput.pressKey("f", { ctrl: true })
        await app.waitForFrame((frame) => frame.includes("minimize"))
        const actions = app.renderer.root.findDescendantById("session.permission.actions")!
        const bottom = actions.y
        expect(bottom).toBeLessThan(27)
        for (let i = 0; i < 15; i++) {
          app.mockInput.pressKey("\x1b[6~")
          await app.renderOnce()
        }
        expect(app.captureCharFrame()).toContain(patterns.at(-1)!)
        expect(app.captureCharFrame()).toContain("Always allow")
        expect(actions.y).toBe(bottom)
        expect(app.captureCharFrame()).not.toMatch(/\+\d+ more/)
        app.mockInput.pressKey("f", { ctrl: true })
        await app.waitForFrame((frame) => frame.includes(`+${count - limit} more`))
        app.mockInput.pressKey("ARROW_LEFT")
        await app.waitForFrame((frame) => frame.includes("git status --short"))
        expect(app.captureCharFrame()).not.toContain("check-package")
        app.mockInput.pressKey("ARROW_RIGHT")
        await app.waitForFrame((frame) => frame.includes(`+${count - limit} more`))
        app.mockInput.pressEnter()
        await app.waitFor(() => replies.length === 1)
        expect(replies).toEqual([{ reply: "always" }])
      } finally {
        app.renderer.destroy()
      }
    })
  }
  for (const save of [["*"], ["git status *"]]) {
    test(`keeps the minimal ${save[0]} preview at ${width} columns`, async () => {
      await using tmp = await tmpdir()
      const { app } = await mount(tmp.path, width, save)
      try {
        expect(app.captureCharFrame()).toContain(save[0] === "*" ? "shell for this project" : "git status *")
        expect(app.captureCharFrame()).not.toContain("more")
        expect(app.captureCharFrame()).toContain("Always allow")
      } finally {
        app.renderer.destroy()
      }
    })
  }
  test(`shows a long pattern in full only when expanded at ${width} columns`, async () => {
    await using tmp = await tmpdir()
    const pattern = `./scripts/${"long-directory/".repeat(10)}BOUNDARY_SENTINEL *`
    const { app } = await mount(tmp.path, width, [pattern])
    try {
      expect(app.captureCharFrame()).toContain("...")
      app.mockInput.pressKey("f", { ctrl: true })
      await app.waitForFrame((frame) => frame.includes("minimize"))
      expect(app.captureCharFrame()).toContain("BOUNDARY_SENTINEL")
      expect(app.captureCharFrame().replace(/[┃█▀▄\s]/g, "")).toContain(pattern.replace(/\s/g, ""))
      expect(app.captureCharFrame()).toContain("Always allow")
    } finally {
      app.renderer.destroy()
    }
  })
  test(`omits Always allow without saved patterns at ${width} columns`, async () => {
    await using tmp = await tmpdir()
    const { app } = await mount(tmp.path, width, [], false)
    try {
      expect(app.captureCharFrame()).not.toContain("Always allow")
      expect(app.captureCharFrame()).toContain("Allow once")
      expect(app.captureCharFrame()).toContain("Reject")
    } finally {
      app.renderer.destroy()
    }
  })
}
