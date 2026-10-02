/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider } from "../../src/keymap"
import homeTips from "../../src/feature-plugins/home/tips"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

async function frame(height: number) {
  const config = createTuiResolvedConfig()
  function Harness() {
    const keymap = createDefaultOpenTuiKeymap(useRenderer())
    const slots: TuiSlotPlugin[] = []
    const base = createTuiPluginApi({ keymap })
    const api = {
      ...base,
      slots: { register: (plugin: TuiSlotPlugin) => slots.push(plugin) },
      state: { ...base.state, session: { ...base.state.session, count: () => 0 }, provider: [] },
    } as unknown as TuiPluginApi
    void homeTips.tui(api, undefined, {} as never)
    const render = slots[0]?.slots?.home_bottom as (() => JSX.Element) | undefined

    return (
      <TestTuiContexts>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <box width="100%" height="100%" flexDirection="column">
                  <box height={3} flexShrink={0}>
                    <text>PROMPT</text>
                  </box>
                  <box flexGrow={1} minHeight={0} alignItems="center">
                    {render?.()}
                  </box>
                  <text flexShrink={0}>FOOTER</text>
                </box>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  testSetup = await testRender(() => <Harness />, { width: 80, height })
  const start = Date.now()
  while (!testSetup.captureCharFrame().includes("PROMPT")) {
    if (Date.now() - start > 2000) throw new Error("timed out waiting for the home screen to render")
    await testSetup.renderOnce()
    await Bun.sleep(10)
  }
  return testSetup.captureCharFrame().split("\n")
}

test("keeps the tip above the footer when there is no room for its top spacing", async () => {
  const lines = await frame(5)
  const tip = lines.findIndex((line) => line.includes("Tip"))
  const footer = lines.findIndex((line) => line.includes("FOOTER"))

  expect(tip).toBeGreaterThan(-1)
  expect(footer).toBeGreaterThan(tip)
  expect(lines[footer]).not.toContain("Tip")
})

test("keeps the tip spacing when there is room", async () => {
  const lines = await frame(12)

  expect(lines.findIndex((line) => line.includes("Tip"))).toBe(6)
})
