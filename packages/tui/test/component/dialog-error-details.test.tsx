/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogErrorDetails } from "../../src/component/dialog-error-details"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider, useRoute } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

for (const width of [40, 100]) {
  test(`error details stay compact at ${width} columns and investigate only prepares a draft`, async () => {
    await using temporary = await tmpdir()
    const source = "/private/var/folders/very-long-temporary-directory/opencode/project/plugins/broken/index.ts"
    const copied: string[] = []
    const submitted: string[] = []
    let route: ReturnType<typeof useRoute> | undefined
    const api = createApi(
      createFetch((url, request) => {
        if (request.method === "POST") submitted.push(url.pathname)
        return undefined
      }, createEventStream()).fetch,
    )

    function OpenDialog() {
      route = useRoute()
      const dialog = useDialog()
      onMount(() =>
        dialog.replace(
          <DialogErrorDetails
            title="Server plugin error"
            source={source}
            error="Plugin failed to load"
            context={`Plugin: broken\nRuntime: server\nSource: ${source}`}
            diagnosticRef="err_a1b2c3d4"
            onBack={() => dialog.clear()}
          />,
        ),
      )
      return null
    }

    const app = await testRender(
      () => (
        <TestTuiContexts
          directory={temporary.path}
          paths={{ state: temporary.path }}
          clipboard={{ read: async () => undefined, write: async (text) => void copied.push(text) }}
        >
          <ConfigProvider config={createTuiResolvedConfig()}>
            <RouteProvider initialRoute={{ type: "home" }}>
              <ClientProvider api={api}>
                <DataProvider directory={temporary.path}>
                  <LocationProvider>
                    <ThemeProvider mode={width === 40 ? "light" : "dark"} source={emptyThemeSource}>
                      <Keymap.Provider>
                        <ToastProvider>
                          <DialogProvider>
                            <OpenDialog />
                          </DialogProvider>
                        </ToastProvider>
                      </Keymap.Provider>
                    </ThemeProvider>
                  </LocationProvider>
                </DataProvider>
              </ClientProvider>
            </RouteProvider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width, height: 24, kittyKeyboard: true },
    )

    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("Reference: err_a1b2c3d4"))
      const lines = app.captureCharFrame().split("\n")
      const heading = lines.find((line) => line.includes("Server plugin error"))
      expect(heading).toContain("esc")
      expect(lines.some((line) => line.includes("broken/index.ts"))).toBe(true)
      expect(lines.join("\n")).not.toContain("very-long-temporary-directory")
      const message = lines.find((line) => line.includes("Plugin failed to load"))
      const reference = lines.find((line) => line.includes("Reference:"))
      expect(message?.indexOf("Plugin")).toBe(reference?.indexOf("Reference:"))
      expect(lines.filter((line) => line.trim()).length).toBeLessThanOrEqual(6)

      app.mockInput.pressKey("c")
      await app.waitFor(() => copied.length === 1)
      expect(copied[0]).toContain(source)
      expect(copied[0]).toContain("Reference: err_a1b2c3d4")
      app.mockInput.pressKey("i")
      await app.waitFor(() => route?.data.type === "home" && !!route.data.prompt)
      const current = route?.data
      expect(current?.type === "home" && current.prompt?.text).toContain(source)
      expect(current?.type === "home" && current.prompt?.text).toContain("matching reference err_a1b2c3d4")
      expect(submitted).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
}
