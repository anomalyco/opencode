/** @jsxImportSource @opentui/solid */
import { BoxRenderable, type Renderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { createSignal, onCleanup, onMount } from "solid-js"
import { TuiConfigProvider, type Info } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createFetch, directory, eventSource } from "../../fixture/tui-sdk"

test.each([
  { config: {}, height: 15 },
  { config: { max_height: 30 }, height: 30 },
  { config: { default_expanded: false }, height: 15 },
])("renders a collapsed permission prompt with $config", async ({ config, height }) => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, config)
  try {
    expect(panel(prompt.app.renderer.root)?.height).toBe(height)
    expect(prompt.app.captureCharFrame()).toContain("fullscreen")
    expect(prompt.app.captureCharFrame()).toContain("Allow once")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("opens fullscreen by default and toggles back to the configured height", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, { max_height: 20, default_expanded: true })
  try {
    expect(panel(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
    expect(prompt.app.captureCharFrame()).toContain("minimize")

    prompt.app.mockInput.pressKey("f", { ctrl: true })
    await prompt.app.flush()
    expect(panel(prompt.app.renderer.root)?.height).toBe(20)
    expect(prompt.app.captureCharFrame()).toContain("fullscreen")

    prompt.app.mockInput.pressKey("f", { ctrl: true })
    await prompt.app.flush()
    expect(panel(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
    expect(prompt.app.captureCharFrame()).toContain("minimize")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test.each([{ expanded: false }, { expanded: true }])(
  "restores default_expanded=$expanded for each new request",
  async ({ expanded }) => {
    await using tmp = await tmpdir()
    const prompt = await mountPrompt(tmp.path, { default_expanded: expanded })
    try {
      prompt.app.mockInput.pressKey("f", { ctrl: true })
      await prompt.app.flush()
      expect(prompt.app.captureCharFrame()).toContain(expanded ? "fullscreen" : "minimize")

      prompt.setRequest((request) => ({ ...request, metadata: { updated: true } }))
      await prompt.app.flush()
      expect(prompt.app.captureCharFrame()).toContain(expanded ? "fullscreen" : "minimize")

      prompt.setRequest((request) => ({ ...request, id: "permission-2" }))
      await prompt.app.flush()
      expect(prompt.app.captureCharFrame()).toContain(expanded ? "minimize" : "fullscreen")
      if (expanded) expect(panel(prompt.app.renderer.root)?.height).toBeGreaterThan(30)
      if (!expanded) expect(panel(prompt.app.renderer.root)?.height).toBe(15)
    } finally {
      prompt.app.renderer.destroy()
    }
  },
)

test("keeps always-allow confirmation collapsed when default_expanded is enabled", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPrompt(tmp.path, { max_height: 20, default_expanded: true })
  try {
    prompt.app.mockInput.pressKey("ARROW_RIGHT")
    prompt.app.mockInput.pressEnter()
    await prompt.app.flush()
    expect(prompt.app.captureCharFrame()).toContain("Always allow")
    expect(prompt.app.captureCharFrame()).not.toContain("minimize")
    expect(panel(prompt.app.renderer.root)?.height).toBeLessThanOrEqual(20)
    expect(prompt.app.captureCharFrame()).toContain("Confirm")

    prompt.app.mockInput.pressKey("f", { ctrl: true })
    await prompt.app.flush()
    expect(prompt.app.captureCharFrame()).not.toContain("minimize")
    expect(panel(prompt.app.renderer.root)?.height).toBeLessThanOrEqual(20)
  } finally {
    prompt.app.renderer.destroy()
  }
})

async function mountPrompt(state: string, config: Info["permission_prompt"]) {
  await Bun.write(`${state}/kv.json`, "{}")
  const resolved = createTuiResolvedConfig({ permission_prompt: config })
  const calls = createFetch()
  const ready = Promise.withResolvers<void>()
  const [request, setRequest] = createSignal<PermissionRequest>({
    id: "permission-1",
    sessionID: "session-1",
    permission: "external_directory",
    patterns: Array.from({ length: 60 }, (_, index) => `/external/file-${index}`),
    metadata: { parentDir: "/external" },
    always: ["/external/*"],
  })

  function Content() {
    onMount(() => ready.resolve())
    return (
      <box height="100%" justifyContent="flex-end">
        <box flexShrink={0}>
          <PermissionPrompt request={request()} />
        </box>
      </box>
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, resolved))

    return (
      <TestTuiContexts paths={{ state }}>
        <ArgsProvider>
          <TuiConfigProvider config={resolved}>
            <OpencodeKeymapProvider keymap={keymap}>
              <KVProvider>
                <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                  <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={eventSource()}>
                    <PermissionProvider>
                      <ProjectProvider>
                        <ExitProvider exit={() => {}}>
                          <SyncProvider>
                            <LocationProvider location={{ directory }}>
                              <Content />
                            </LocationProvider>
                          </SyncProvider>
                        </ExitProvider>
                      </ProjectProvider>
                    </PermissionProvider>
                  </SDKProvider>
                </ThemeProvider>
              </KVProvider>
            </OpencodeKeymapProvider>
          </TuiConfigProvider>
        </ArgsProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 40 })
  await ready.promise
  await app.renderOnce()
  return { app, setRequest }
}

function panel(root: Renderable): BoxRenderable | undefined {
  if (root instanceof BoxRenderable && Array.isArray(root.border) && root.border.includes("left")) return root
  return root.getChildren().map(panel).find(Boolean)
}
