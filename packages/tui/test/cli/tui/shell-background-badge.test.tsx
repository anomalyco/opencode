/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SessionMessageAssistantTool } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { createTimelineAnchors } from "../../../src/routes/session/anchors"
import { context } from "../../../src/routes/session/render-context"
import { Shell } from "../../../src/routes/session/index"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createFetch } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const cases = [
  { label: "interrupted foreground", state: "error" as const, status: undefined, background: false },
  { label: "completed foreground", state: "completed" as const, status: "completed", background: false },
  { label: "actual background handoff", state: "completed" as const, status: "running", background: true },
]

test.each([40, 80].flatMap((width) => cases.map((item) => ({ ...item, width }))))(
  "$label shell badge follows handoff at $width columns",
  async ({ state, status, background, width }) => {
    await using temporary = await tmpdir()
    const config = createTuiResolvedConfig({ animations: false })
    const metadata = { shellID: "sh_progress", ...(status ? { status } : {}) }
    const part: SessionMessageAssistantTool = {
      type: "tool",
      id: "call_shell",
      name: "shell",
      time: { created: 0, completed: 1 },
      state:
        state === "error"
          ? {
              status: "error",
              input: { command: "sleep 60" },
              metadata,
              error: { type: "aborted", message: "Tool execution interrupted" },
            }
          : {
              status: "completed",
              input: { command: "sleep 60" },
              metadata,
              content: [{ type: "text", text: "done" }],
            },
    }
    const app = await testRender(
      () => (
        <TestTuiContexts paths={{ state: temporary.path }}>
          <ArgsProvider>
            <ConfigProvider config={config}>
              <Keymap.Provider>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "session", sessionID: "ses_fixture" }}>
                      <ClientProvider api={createApi(createFetch().fetch)}>
                        <DataProvider directory="/tmp/opencode/packages/tui">
                          <LocationProvider>
                            <PermissionProvider>
                              <LocalProvider>
                                <context.Provider
                                  value={{
                                    width,
                                    terminal: { width, height: 24 },
                                    sessionID: "ses_fixture",
                                    anchors: createTimelineAnchors(),
                                    groupExpanded: () => false,
                                    setGroupExpanded: () => {},
                                    thinkingMode: () => "hide",
                                    markdownMode: () => "rendered",
                                    groupExploration: () => false,
                                    legacyTurns: () => false,
                                    diffWrapMode: () => "word",
                                    models: () => [],
                                    messageIndex: () => undefined,
                                    config,
                                    mutatePending: async () => true,
                                    pendingDelivery: () => undefined,
                                  }}
                                >
                                  <Shell part={part} tool="shell" input={{ command: "sleep 60" }} metadata={metadata} />
                                </context.Provider>
                              </LocalProvider>
                            </PermissionProvider>
                          </LocationProvider>
                        </DataProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </ThemeProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </ArgsProvider>
        </TestTuiContexts>
      ),
      { width, height: 24 },
    )
    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes(state === "error" ? "Tool execution interrupted" : "sleep 60"))
      expect(app.captureCharFrame().includes("Background")).toBe(background)
    } finally {
      app.renderer.destroy()
    }
  },
)
