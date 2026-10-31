/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { InteractivityProvider } from "../../../src/context/interactivity"
import { LocationProvider } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const file = (name: string, patch: string) => ({ file: name, patch, additions: 1, deletions: 1, status: "modified" })

async function render(root: string, request: PermissionRequest) {
  const transport = createFetch(() => undefined, createEventStream())
  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state: root, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
          <Keymap.Provider>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider directory={root}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <ToastProvider>
                      <InteractivityProvider enabled>
                        <PermissionPrompt request={request} />
                      </InteractivityProvider>
                    </ToastProvider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 40, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.renderOnce()
  await app.renderOnce()
  return app
}

test("multi-file edit prompt labels each diff with its own file, including a move target", async () => {
  await using tmp = await tmpdir()
  // A move lists source and destination in resources, so resources are longer than the file entries.
  const app = await render(tmp.path, {
    id: "per_edit",
    sessionID: "ses_edit",
    action: "edit",
    resources: ["src/old.ts", "src/new.ts", "src/other.ts"],
    metadata: {
      files: [
        file("src/new.ts", "@@ -1 +1 @@\n-one\n+FIRST_DIFF\n"),
        file("src/other.ts", "@@ -1 +1 @@\n-two\n+SECOND_DIFF\n"),
      ],
    },
  } satisfies PermissionRequest)
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Edit 2 files")
    expect(frame).toContain("src/new.ts")
    expect(frame).toContain("src/other.ts")
    expect(frame).not.toContain("old.ts")
    expect(frame).toContain("FIRST_DIFF")
    expect(frame).toContain("SECOND_DIFF")
  } finally {
    app.renderer.destroy()
  }
})
