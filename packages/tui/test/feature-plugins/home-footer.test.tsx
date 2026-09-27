/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { testRender, type JSX } from "@opentui/solid"
import { SyncContext } from "../../src/context/sync"
import { HomeSessionDestinationProvider } from "../../src/routes/home/session-destination"
import homeFooter from "../../src/feature-plugins/home/footer"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiPluginApi } from "../fixture/tui-plugin"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

const directory = "/tmp/opencode/home/Desktop/Project With A Long Name"

async function footer(branch: string) {
  const slots: TuiSlotPlugin[] = []
  const api = {
    ...createTuiPluginApi(),
    app: { version: "1.18.32" },
    slots: { register: (plugin: TuiSlotPlugin) => slots.push(plugin) },
    state: {
      mcp: () => [{ name: "demo", status: "connected" }],
      path: { directory },
      vcs: { branch },
    },
  } as unknown as TuiPluginApi
  await homeFooter.tui(api, undefined, {} as never)
  const render = slots[0]?.slots?.home_footer
  if (!render) throw new Error("home_footer slot was not registered")
  return render as () => JSX.Element
}

async function frame(branch: string, width: number, height: number) {
  const render = await footer(branch)
  testSetup = await testRender(
    () => (
      <TestTuiContexts directory={directory}>
        <SyncContext.Provider value={{ path: { directory } } as never}>
          <HomeSessionDestinationProvider>
            <box width="100%" height="100%" flexDirection="column">
              <box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="flex-end">
                <text>ROW ABOVE FOOTER</text>
              </box>
              <box width="100%" flexShrink={0}>
                {render()}
              </box>
            </box>
          </HomeSessionDestinationProvider>
        </SyncContext.Provider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  await testSetup.renderOnce()
  return testSetup.captureCharFrame().split("\n")
}

test.each([
  [66, 16],
  [66, 10],
  [44, 12],
])("keeps the footer on one line without overlapping the row above at %ix%i", async (width, height) => {
  const lines = await frame("feature/a-rather-long-branch-name", width, height)

  const content = lines.filter((line) => line.trim())
  expect(content).toHaveLength(2)
  expect(content[0]).toContain("ROW ABOVE FOOTER")
  expect(content[1]).toMatch(/~\/.*\.\.\..*-name /)
  expect(content[1]).toContain("1 MCP")
  expect(content[1]).toContain("1.18.32")
})

test("shows the full directory and branch when they fit", async () => {
  const lines = await frame("main", 160, 16)

  expect(lines.some((line) => line.includes(`~/Desktop/Project With A Long Name:main`))).toBe(true)
})
