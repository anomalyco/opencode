/** @jsxImportSource @opentui/solid */
import { Renderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { PermissionRequest } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { ThemeProvider } from "../../src/context/theme"
import { PermissionPrompt } from "../../src/routes/session/permission"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test.each([100, 44])("multiline sandbox approval keeps text separated at %s columns", async (width) => {
  await using temporary = await tmpdir()
  const command = [
    "cat > /outside/workspace/world.c <<'EOF'",
    "#include <stdio.h>",
    "",
    "int main(void) {",
    '    puts("Hello, world!");',
    "    return 0;",
    "}",
    "EOF",
  ].join("\n")
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ClientProvider api={createApi(createFetch(undefined, createEventStream()).fetch)}>
            <DataProvider directory={temporary.path}>
              <LocationProvider>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <Keymap.Provider>
                    <ToastProvider>
                      <box width="100%" height="100%" justifyContent="flex-end">
                        <PermissionPrompt
                          request={{
                            id: "perm-sandbox",
                            sessionID: "ses-sandbox",
                            action: "sandbox.exec",
                            resources: [command],
                            metadata: {
                              command,
                              cwd: "/workspace",
                              justification: "May I create the requested C file outside the workspace sandbox?",
                            },
                          }}
                        />
                      </box>
                    </ToastProvider>
                  </Keymap.Provider>
                </ThemeProvider>
              </LocationProvider>
            </DataProvider>
          </ClientProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 24, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    for (const columns of [width, width === 100 ? 44 : 100, width]) {
      app.resize(columns, 24)
      await app.renderOnce()
      separated(app.renderer.root)
      const scroll = app.renderer.root.findDescendantById("session.permission.body")
      const actions = app.renderer.root.findDescendantById("session.permission.actions")
      if (!(scroll instanceof ScrollBoxRenderable) || !actions) throw new Error("Permission body or actions missing")
      const details = app.renderer.root.findDescendantById("session.permission.details")
      if (!details) throw new Error("Permission details missing")
      const commandText = texts(scroll).find((item) => item.plainText.startsWith("$ cat >"))
      if (!commandText) throw new Error("Command text missing")
      for (const prefix of ["Reason:", "Directory:", "This command", "Approval applies"]) {
        const detail = texts(details).find((item) => item.plainText.startsWith(prefix))
        if (!detail) throw new Error(`Permission detail missing: ${prefix}`)
        expect(detail.fg.equals(commandText.fg)).toBe(false)
      }
      expect(details.y + details.height).toBeLessThanOrEqual(scroll.viewport.y)
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport.height)
      expect(scroll.viewport.y + scroll.viewport.height).toBeLessThanOrEqual(actions.y)
      scroll.scrollTo(0)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("$ cat >")
      expect(app.captureCharFrame()).toContain("Reason:")
      expect(app.captureCharFrame()).toContain("Directory: /workspace")
      expect(app.captureCharFrame()).toContain("Approval applies")
      await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 1, "down")
      await app.renderOnce()
      expect(scroll.scrollTop).toBeGreaterThan(0)
      scroll.scrollTo(scroll.scrollHeight)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Approval applies")
      expect(app.captureCharFrame()).toContain("Reason:")
      expect(app.captureCharFrame()).toContain("Directory: /workspace")
      expect(app.captureCharFrame()).toContain("Allow once")
      expect(app.captureCharFrame()).toContain("Reject")
      separated(app.renderer.root)
    }
    app.mockInput.pressKey("f", { ctrl: true })
    await app.renderOnce()
    separated(app.renderer.root)
    expect(app.captureCharFrame()).toContain("Allow once")
    app.mockInput.pressEscape()
    await app.renderOnce()
    separated(app.renderer.root)
    expect(app.captureCharFrame()).toContain("Reject")
  } finally {
    app.renderer.destroy()
  }
})

test.each([100, 44])(
  "main session-prefix approval presents its scope and sends explicit consent at %s columns",
  async (width) => {
    await using temporary = await tmpdir()
    const [request, setRequest] = createSignal<PermissionRequest>({
      id: "per_prefix",
      sessionID: "ses_prefix",
      action: "sandbox.exec",
      resources: ["npm install one"],
      save: ["npm install"],
      metadata: { command: "npm install one", cwd: "/workspace", justification: "Download a dependency" },
    })
    const reply = Promise.withResolvers<unknown>()
    const api = createApi(
      createFetch(async (url, request) => {
        if (url.pathname.endsWith("/per_prefix/reply")) {
          reply.resolve(await request.json())
          return new Response(null, { status: 204 })
        }
      }, createEventStream()).fetch,
    )
    const app = await testRender(
      () => (
        <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
          <ConfigProvider config={createTuiResolvedConfig()}>
            <ClientProvider api={api}>
              <DataProvider directory={temporary.path}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <Keymap.Provider>
                      <ToastProvider>
                        <box width="100%" height="100%" justifyContent="flex-end">
                          <PermissionPrompt request={request()} />
                        </box>
                      </ToastProvider>
                    </Keymap.Provider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width, height: 24, kittyKeyboard: true },
    )
    try {
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Allow prefix for session")
      expect(app.captureCharFrame()).toContain("Reject")
      const actions = app.renderer.root.findDescendantById("session.permission.actions")
      if (!actions) throw new Error("Permission actions missing")
      for (const item of actions.getChildren()) {
        expect(item.x + item.width).toBeLessThanOrEqual(width)
      }
      app.mockInput.pressArrow("right")
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("npm install")
      expect(frame).toContain("/workspace")
      expect(frame).toContain("Reason:")
      const details = app.renderer.root.findDescendantById("session.permission.details")
      if (!details) throw new Error("Session prefix details missing")
      expect(texts(details).some((item) => item.plainText.startsWith("Matching commands"))).toBe(true)
      expect(texts(details).some((item) => item.plainText.startsWith("Session prefix:"))).toBe(true)
      const scope = app.renderer.root.findDescendantById("session.permission.body")
      if (!(scope instanceof ScrollBoxRenderable)) throw new Error("Session scope scrollbox missing")
      expect(scope.viewport.y + scope.viewport.height).toBeLessThanOrEqual(actions.y)
      scope.scrollTo(scope.scrollHeight)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("server restarts")
      app.mockInput.pressEnter()
      expect(await reply.promise).toEqual({ decision: "always", experimental: { acknowledgeSandbox: true, saveSandboxPrefix: true } })
      // A subsequent request must not inherit the previous option selection.
      setRequest({ ...request(), id: "per_next", save: undefined })
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Allow prefix for session")
    } finally {
      app.renderer.destroy()
    }
  },
)

function texts(item: Renderable): TextRenderable[] {
  return [...(item instanceof TextRenderable ? [item] : []), ...item.getChildren().flatMap(texts)]
}

function separated(root: Renderable) {
  const lines = texts(root).filter(
    (item) =>
      item.plainText.startsWith("Directory:") ||
      item.plainText.startsWith("Reason:") ||
      item.plainText.startsWith("This command") ||
      item.plainText.startsWith("Approval applies"),
  )
  expect(lines).toHaveLength(4)
  for (const line of lines) {
    expect({ text: line.plainText, height: line.height }).toMatchObject({ height: line.virtualLineCount })
  }
  for (let index = 1; index < lines.length; index++) {
    expect(lines[index].y).toBeGreaterThanOrEqual(lines[index - 1].y + lines[index - 1].height)
  }
}
