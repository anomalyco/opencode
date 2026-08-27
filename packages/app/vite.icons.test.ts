import { expect, test } from "bun:test"
import { fetch } from "bun"
import { build, createServer } from "vite"
import { icons } from "./vite.icons"
import manifest from "./manifest.json" with { type: "json" }

test.each(["dev", "beta", "prod", "local"])("bundles %s app icons", async (channel) => {
  const result = await build({
    root: import.meta.dirname,
    configFile: false,
    logLevel: "silent",
    plugins: [
      icons(channel),
      {
        name: "icons-only-fixture",
        transformIndexHtml: {
          order: "pre",
          handler: (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
        },
      },
    ],
    build: { write: false, copyPublicDir: false },
  })
  if (!("output" in result)) throw new Error("Expected a single build output")

  await check(channel === "local" ? "dev" : channel, async (path) => {
    const file = result.output.find((file) => `/${file.fileName}` === path)
    if (file?.type !== "asset") throw new Error(`Missing asset: ${path}`)
    return typeof file.source === "string" ? new TextEncoder().encode(file.source) : file.source
  })
})

test.each(["dev", "beta", "prod"])("serves %s app icons", async (channel) => {
  const server = await createServer({
    root: import.meta.dirname,
    configFile: false,
    logLevel: "silent",
    plugins: [icons(channel)],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, hmr: false, preTransformRequests: false, watch: null },
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === "string") throw new Error("Expected an HTTP port")

    await check(channel, async (path) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
      expect(response.status).toBe(200)
      if (path.endsWith(".webmanifest")) expect(response.headers.get("content-type")).toBe("application/manifest+json")
      if (path.endsWith(".png")) expect(response.headers.get("content-type")).toBe("image/png")
      return new Uint8Array(await response.arrayBuffer())
    })
  } finally {
    await server.close()
  }
})

async function check(channel: string, read: (path: string) => Promise<Uint8Array>) {
  const html = new TextDecoder().decode(await read("/index.html"))
  const actual: typeof manifest = JSON.parse(new TextDecoder().decode(await read("/site.webmanifest")))
  expect(actual).toEqual({
    ...manifest,
    icons: manifest.icons.map((icon) => ({ ...icon, src: `/icons/${channel}${icon.src}` })),
  })
  expect(html).toContain(`href="/icons/${channel}/favicon.ico"`)
  expect(html).toContain(`href="/icons/${channel}/apple-touch-icon.png"`)
  expect(html).toContain(`href="/site.webmanifest"`)
  expect(html).not.toContain("%OPENCODE_")

  await Promise.all(
    Object.entries({
      "favicon.ico": "icon.ico",
      "apple-touch-icon.png": "ios/AppIcon-60x60@3x.png",
      "web-app-manifest-192x192.png": "android/mipmap-xxxhdpi/ic_launcher.png",
      "web-app-manifest-512x512.png": "icon.png",
    }).map(async ([name, source]) => {
      const bytes = await read(`/icons/${channel}/${name}`)
      expect(bytes).toEqual(await Bun.file(new URL(`../desktop/icons/${channel}/${source}`, import.meta.url)).bytes())
      if (!name.endsWith(".png")) return
      const size = name === "apple-touch-icon.png" ? 180 : Number(name.match(/(192|512)/)?.[0])
      expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(16)).toBe(size)
      expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(20)).toBe(size)
    }),
  )
}
