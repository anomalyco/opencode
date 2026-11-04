/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the session action dialogs: the timeline (packages/tui/src/routes/session/dialog-timeline.tsx),
// fork (dialog-fork.tsx), rename (component/dialog-session-rename.tsx), and export options
// (ui/dialog-export-options.tsx). crates/tui/tests/actions.rs (`dialogs_match_typescript`) mounts the Rust TUI over
// the same session and messages (`turns()` there; keep both in step), hides the screen behind the dialog, and
// compares the cells. The Rust TUI is the `new-designs` one, so the experiment is on. Times render in UTC here;
// the Rust test shifts the messages by its local offset.
process.env.TZ = "UTC"

import { onMount, type JSX } from "solid-js"
import { DialogSessionRename } from "../../../tui/src/component/dialog-session-rename"
import { ConfigProvider } from "../../../tui/src/config"
import { ArgsProvider } from "../../../tui/src/context/args"
import { ClientProvider } from "../../../tui/src/context/client"
import { DataProvider, useData } from "../../../tui/src/context/data"
import { Keymap } from "../../../tui/src/context/keymap"
import { LocalProvider } from "../../../tui/src/context/local"
import { LocationProvider } from "../../../tui/src/context/location"
import { PermissionProvider } from "../../../tui/src/context/permission"
import { RouteProvider } from "../../../tui/src/context/route"
import { TuiAppProvider } from "../../../tui/src/context/runtime"
import { StorageProvider } from "../../../tui/src/context/storage"
import { ThemeProvider } from "../../../tui/src/context/theme"
import { DialogFork } from "../../../tui/src/routes/session/dialog-fork"
import { DialogTimeline } from "../../../tui/src/routes/session/dialog-timeline"
import { DialogProvider, useDialog } from "../../../tui/src/ui/dialog"
import { DialogExportOptions } from "../../../tui/src/ui/dialog-export-options"
import { DialogExportResult } from "../../../tui/src/ui/dialog-export-result"
import { ToastProvider } from "../../../tui/src/ui/toast"
import { emptyThemeSource } from "../../../tui/test/fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../../tui/test/fixture/tui-client"
import { TestTuiContexts } from "../../../tui/test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { renderComponent } from "../lib/component"

const directory = "/project"
const user = (id: string, created: number, text: string) => ({ id, type: "user", text, time: { created } })
const assistant = (id: string, created: number, content: unknown[]) => ({
  id,
  type: "assistant",
  agent: "build",
  model: { providerID: "p", id: "m" },
  time: { created, completed: created + 1000 },
  finish: "stop",
  content,
})
const messages = [
  user("msg_01", 1_772_539_200_000, "Read the parser"),
  assistant("msg_02", 1_772_539_201_000, [{ type: "text", id: "t1", text: "I read it." }]),
  user("msg_03", 1_772_539_260_000, "Fix the bug\nin parse"),
  assistant("msg_04", 1_772_539_261_000, [{ type: "text", id: "t2", text: "Fixed it." }]),
]

const calls = createFetch((url) => {
  if (url.pathname === "/api/session/ses_a/message") return json({ data: messages.toReversed(), cursor: {} })
  return undefined
}, createEventStream())

function Probe(props: { open: () => JSX.Element }) {
  const data = useData()
  const dialog = useDialog()
  onMount(() => {
    void data.session.message.sync("ses_a").then(() => dialog.replace(props.open))
  })
  return null
}

async function render(fixture: string, open: () => JSX.Element, ready: (frame: string) => boolean, act?: Act) {
  await renderComponent({
    fixture,
    width: 100,
    height: 30,
    bare: () => (
      <TestTuiContexts directory={directory}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider
                config={createTuiResolvedConfig({ animations: false, experimental: { "new-designs": true } })}
              >
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "session", sessionID: "ses_a" }}>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={directory}>
                            <LocationProvider>
                              <ThemeProvider mode="dark" source={emptyThemeSource}>
                                <LocalProvider>
                                  <DialogProvider>
                                    <Probe open={open} />
                                  </DialogProvider>
                                </LocalProvider>
                              </ThemeProvider>
                            </LocationProvider>
                          </DataProvider>
                        </PermissionProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </Keymap.Provider>
              </ConfigProvider>
            </ArgsProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    ready,
    act,
  })
}

type Act = Parameters<typeof renderComponent>[0]["act"]

await render(
  "E.10a/timeline",
  () => <DialogTimeline sessionID="ses_a" onMove={() => {}} />,
  (frame) => frame.includes("Read the parser"),
)
await render(
  "E.10a/fork",
  () => <DialogFork sessionID="ses_a" onMove={() => {}} />,
  (frame) => frame.includes("Read the parser"),
)
await render(
  "E.10a/rename",
  () => <DialogSessionRename sessionID="ses_a" currentTitle="Fix the parser" />,
  (frame) => frame.includes("Rename session"),
)
await render(
  "E.10a/export",
  () => <DialogExportOptions defaultThinking={true} />,
  (frame) => frame.includes("Export session"),
)
await render(
  "E.10a/export-result",
  () => <DialogExportResult path="/tmp/session-0b6c1f62-3d4e-4b7a-9f1e-2a5c8d7e6f40.md" />,
  (frame) => frame.includes("Session exported"),
)
await render(
  "E.10a/export-json",
  () => <DialogExportOptions defaultThinking={true} />,
  (frame) => frame.includes("Export session"),
  async (setup) => {
    setup.mockInput.pressArrow("right")
    await Bun.sleep(50)
  },
)
