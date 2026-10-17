/** @jsxImportSource @opentui/solid */
import { BoxRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { PermissionRequest } from "@opencode/client"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider, type Info } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { ToastProvider } from "../../../src/ui/toast"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createApi, createEventStream, createFetch } from "../../fixture/tui-client"

test.each([
  { config: undefined, height: 15 },
  { config: { max_height: 30 }, height: 30 },
  { config: { default_expanded: false }, height: 15 },
])("renders a collapsed permission prompt with $config", async ({ config, height }) => {
  const prompt = await mountPrompt(config)
  try {
    expect(dialog(prompt.app.renderer.root)?.height).toBe(height)
    expect(prompt.app.captureCharFrame()).toContain("fullscreen")
    expect(prompt.app.captureCharFrame()).toContain("Allow once")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("opens fullscreen by default and toggles back to the configured height", async () => {
  const prompt = await mountPrompt({ max_height: 20, default_expanded: true })
  try {
    expect(dialog(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
    expect(prompt.app.captureCharFrame()).toContain("minimize")

    prompt.app.mockInput.pressKey("f", { ctrl: true })
    await prompt.app.waitForFrame((frame) => !frame.includes("minimize"))
    expect(dialog(prompt.app.renderer.root)?.height).toBe(20)
    expect(prompt.app.captureCharFrame()).toContain("fullscreen")

    prompt.app.mockInput.pressKey("f", { ctrl: true })
    await prompt.app.waitForFrame((frame) => frame.includes("minimize"))
    expect(dialog(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
  } finally {
    prompt.app.renderer.destroy()
  }
})

test.each([{ expanded: false }, { expanded: true }])(
  "restores default_expanded=$expanded for each new request",
  async ({ expanded }) => {
    const prompt = await mountPrompt({ default_expanded: expanded })
    try {
      prompt.app.mockInput.pressKey("f", { ctrl: true })
      await prompt.app.waitForFrame((frame) => frame.includes(expanded ? "fullscreen" : "minimize"))

      prompt.setRequest((request) => ({ ...request, metadata: { parentDir: "/other" } }))
      await prompt.app.waitForFrame((frame) => frame.includes(expanded ? "fullscreen" : "minimize"))

      prompt.setRequest((request) => ({ ...request, id: "per_2" }))
      await prompt.app.waitForFrame((frame) => frame.includes(expanded ? "minimize" : "fullscreen"))
      if (expanded) expect(dialog(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
      if (!expanded) expect(dialog(prompt.app.renderer.root)?.height).toBe(15)
    } finally {
      prompt.app.renderer.destroy()
    }
  },
)

async function mountPrompt(config: Info["permission_prompt"]) {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const [request, setRequest] = createSignal<PermissionRequest>({
    id: "per_1",
    sessionID: "ses_1",
    action: "external_directory",
    resources: Array.from({ length: 60 }, (_, index) => `/external/file-${index}`),
    metadata: { parentDir: "/external" },
    save: ["/external/*"],
  })

  function Content() {
    return (
      <box height="100%" justifyContent="flex-end">
        <box flexShrink={0}>
          <PermissionPrompt request={request()} />
        </box>
      </box>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ permission_prompt: config })}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider>
                    <LocationProvider>
                      <Content />
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 40, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Permission required"))
  return { app, setRequest }
}

function dialog(root: Renderable): BoxRenderable | undefined {
  if (root instanceof BoxRenderable && Array.isArray(root.border) && root.border.includes("left")) return root
  return root
    .getChildren()
    .map(dialog)
    .find(Boolean)
}
