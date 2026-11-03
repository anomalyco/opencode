/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { pairingQRLink } from "@opencode/util/pairing-link"
import { renderUnicodeCompact } from "@opencode/util/qr"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogPair } from "../../src/component/dialog-pair"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const code = "abc_DEF-123_4567890123"

async function setup(urls: string[], size: { width: number; height: number }) {
  const temporary = await tmpdir()
  const api = createApi(
    createFetch((url) => {
      if (url.pathname === "/api/info")
        return json({ version: "test", pid: 0, urls, paths: { tmp: "/tmp" }, capabilities: { persistentPty: true } })
      if (url.pathname === "/api/pair") return json({ code, expires_in: 300 })
      return undefined
    }).fetch,
  )

  function OpenDialog() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogPair />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <RouteProvider initialRoute={{ type: "home" }}>
            <ClientProvider api={api}>
              <DataProvider directory={temporary.path}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
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
    { ...size, kittyKeyboard: true },
  )
  app.renderer.start()
  return {
    app,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("a QR code taller than the terminal scrolls into view", async () => {
  const urls = ["http://127.0.0.1:4096", "http://192.168.1.2:4096", "http://10.0.0.5:4096"]
  await using fixture = await setup(urls, { width: 80, height: 36 })
  const { app } = fixture
  await app.waitForFrame((frame) => frame.includes("Links"))
  const scroll = app.renderer.root.findDescendantById("pair-body")
  if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Pair body scrollbox missing")
  expect(scroll.viewport.y + scroll.viewport.height).toBeLessThanOrEqual(36)
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport.height)

  const rows = renderUnicodeCompact(pairingQRLink(code, urls) ?? "", { border: 1 }).split("\n")
  const last = rows.at(-2)?.trim() ?? ""
  scroll.scrollTo(scroll.scrollHeight)
  await app.waitForFrame((frame) => frame.includes(last))
})

test("addresses too long for a QR code leave the links and say why", async () => {
  const long = `http://${"a".repeat(400)}.example:4096`
  await using fixture = await setup(["http://127.0.0.1:4096", long], { width: 100, height: 40 })
  const { app } = fixture
  await app.waitForFrame((frame) => frame.includes("addresses are too long"))
  expect(app.captureCharFrame()).toContain("http://127.0.0.1:4096/auth/")
  expect(app.captureCharFrame()).not.toContain("▀▀▀")
})
