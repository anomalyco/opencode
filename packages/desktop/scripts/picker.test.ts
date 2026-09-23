import { expect, test } from "bun:test"
import { loadConfigFromFile, RendererConfigFactory } from "electron-vite"
import { createServer } from "vite"
import { fileURLToPath } from "node:url"
import { pickerPlugin } from "./picker"

test("injects a browser-loadable URL instead of a bare virtual module", () => {
  const plugin = pickerPlugin()
  const tag = plugin.transformIndexHtml.handler()[0]
  expect(tag.attrs.src).toBe("/__vite_opencode_picker_client.js")
  const id = plugin.resolveId(tag.attrs.src)
  expect(id).toBeDefined()
  expect(plugin.load(id!)).toContain("opencodePickerUi")
})

test.each([true, false])(
  "serves browser-loadable picker scripts with bundled dev = %s",
  async (bundledDev) => {
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      fileURLToPath(new URL("../electron.vite.config.ts", import.meta.url)),
    )
    if (!loaded.config.renderer) throw new Error("Missing renderer configuration")
    const config = await new RendererConfigFactory(
      loaded.config.renderer,
      { configFile: false, mode: "development" },
      { root: fileURLToPath(new URL("..", import.meta.url)) },
    ).build()
    const server = await createServer({
      ...config,
      configFile: false,
      root: fileURLToPath(new URL("./fixtures/picker", import.meta.url)),
      build: {
        ...config.build,
        rolldownOptions: { input: { main: fileURLToPath(new URL("./fixtures/picker/index.html", import.meta.url)) } },
      },
      experimental: { bundledDev },
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "silent",
    })
    await server.listen()
    const url = server.resolvedUrls?.local[0]
    if (!url) throw new Error("Missing fixture server URL")
    const socket = bundledDev
      ? new WebSocket(`${url.replace("http:", "ws:")}?token=${server.config.webSocketToken}`, "vite-hmr")
      : undefined
    try {
      if (socket && !server.environments.client.bundledDev?.hasBuildOutput) {
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener("error", reject, { once: true })
          socket.addEventListener("message", (event) => {
            const message: { type: string } = JSON.parse(String(event.data))
            if (message.type === "full-reload") resolve()
          })
        })
      }
      for (const path of ["/", "/index.html", "/server/example/session/example", "/new-session?draftId=example"]) {
        const html = await fetch(new URL(path, url)).then((response) => response.text())
        const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1])
        const scripts = await Promise.all(
          sources.map((source) => fetch(new URL(source, url)).then((response) => response.text())),
        )
        expect(scripts.length).toBeGreaterThan(0)
        if (bundledDev) expect(scripts.join("\n")).toContain("opencodePickerUi")
        expect([html, ...scripts].join("\n")).not.toMatch(/\bimport(?:\s*\(\s*|\s*)["']virtual:/)
      }
      const direct = await fetch(new URL("/__vite_opencode_picker_client.js", url))
      expect(direct.ok).toBe(true)
      expect(await direct.text()).toContain("opencodePickerUi")
    } finally {
      socket?.close()
      await server.close()
    }
  },
  30_000,
)
