import { createServer } from "node:http"
import electron from "electron"
import { icoSample, pngSample, svgSample, type Pixel } from "./icon-samples"

// The Electron main process of `electron-icon.test.ts`, bundled and run by the pinned Electron. It loads the page of
// each made-up site below in a hidden window and prints, as one JSON line, the icons Chromium listed for it and the
// icon the pane makes of that list: a PNG's size in pixels, its length as a data URL and the color in its middle, or
// an SVG's text.

// A site's page lists its icons; the files beside it are what its server answers.
type Site = { links: readonly string[]; files?: Readonly<Record<string, { type: string; body: Buffer | string; status?: number; location?: string }>> }

const solid = (...color: readonly [number, number, number]) => (): Pixel => [...color, 255]

// Pixels no encoder can shrink: at 32px, the longest data URL an icon can have.
const noise = (x: number, y: number): Pixel => {
  const first = Math.imul(x + y * 300 + 1, 0x9e3779b1)
  const second = Math.imul(first ^ (first >>> 15), 0x85ebca6b)
  const third = Math.imul(second ^ (second >>> 13), 0xc2b2ae35)
  const value = (third ^ (third >>> 16)) >>> 0

  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, 128 | (value >>> 24)]
}

const page = (title: string, links: readonly string[]) =>
  `<!doctype html><title>${title}</title>${links.map((href) => `<link rel="icon" href="${href}">`).join("")}<p>${title}</p>`

void electron.app.whenReady().then(async () => {
  const { loadIcon } = await import("./icon")
  const { createDirectNetwork } = await import("./network")

  // Another origin, as a site's static host is. Its icon is a JPEG.
  const elsewhere = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/jpeg" })
    response.end(electron.nativeImage.createFromBuffer(pngSample(64, solid(250, 250, 250))).toJPEG(90))
  })

  await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve))
  const other = elsewhere.address()
  const host = `http://127.0.0.1:${other instanceof Object ? other.port : 0}`

  const sites = new Map(Object.entries<Site>({
    // 16, 32 and 48px bitmaps in one 15,086-byte file, the commonest favicon.ico. The 32px one is green.
    ico: {
      links: ["site.ico"],
      files: {
        "site.ico": {
          type: "image/x-icon",
          body: icoSample([
            { size: 16, bits: 32, paint: solid(255, 0, 0) },
            { size: 32, bits: 32, paint: solid(10, 200, 60) },
            { size: 48, bits: 32, paint: solid(0, 0, 255) },
          ]),
        },
      },
    },
    png: { links: ["icon-180.png"], files: { "icon-180.png": { type: "image/png", body: pngSample(180, solid(240, 90, 30)) } } },
    // Only SVG icons, as a Vite app has: one too long to report, then a short one.
    svg: {
      links: ["b.svg", "a.svg"],
      files: {
        "a.svg": { type: "image/svg+xml", body: svgSample.replace("</svg>", `<!--${"x".repeat(30_000)}--></svg>`) },
        "b.svg": { type: "image/svg+xml", body: svgSample },
      },
    },
    // No <link>: Chromium asks for /favicon.ico, which this server has.
    unlisted: { links: [] },
    // A redirect to the other origin.
    moved: { links: ["icon"], files: { icon: { type: "text/plain", body: "", status: 302, location: `${host}/icon.jpg` } } },
    // Nothing to draw: a page in the icon's place, a missing file and a picture past the size limit.
    refused: {
      links: ["a", "b.png", "c.png"],
      files: { a: { type: "text/html", body: page("Not an icon", []) }, "c.png": { type: "image/png", body: pngSample(300, noise) } },
    },
  }))

  const server = createServer((request, response) => {
    const [, site = "", file = ""] = (request.url ?? "").split("/")

    if (site === "favicon.ico")
      return void response.writeHead(200, { "content-type": "image/x-icon" }).end(icoSample([{ size: 32, bits: 32, paint: noise }]))
    const found = sites.get(site)

    if (!found) return void response.writeHead(404).end()

    if (!file) return void response.writeHead(200, { "content-type": "text/html" }).end(page(site, found.links))
    const answer = found.files?.[file]

    if (!answer) return void response.writeHead(404).end()
    response.writeHead(answer.status ?? 200, { "content-type": answer.type, ...(answer.location && { location: answer.location }) })
    response.end(answer.body)
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  // The pane loads an icon through its page's own session, without that session's cookies.
  const partition = electron.session.fromPartition("icon-fixture")
  const network = createDirectNetwork(partition)
  const win = new electron.BrowserWindow({ show: false, webPreferences: { session: partition } })

  const describe = (icon: string | undefined) => {
    if (!icon) return null
    const type = /^data:([^;,]+)/.exec(icon)?.[1] ?? ""

    if (type !== "image/png") return { type, text: Buffer.from(icon.slice(icon.indexOf(",") + 1), "base64").toString() }
    const image = electron.nativeImage.createFromDataURL(icon)
    const size = image.getSize()
    const middle = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
    // Chromium's bitmaps hold blue first.
    const [blue = 0, green = 0, red = 0] = image.toBitmap().subarray(middle, middle + 3)

    return { type, width: size.width, height: size.height, length: icon.length, color: "#" + [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("") }
  }

  // Loads a site's page and returns the icons Chromium listed for it, as the pane's page hears them, and their icon.
  const visit = async (site: string) => {
    const url = `${origin}/${site}/`
    const listed = Promise.withResolvers<readonly string[]>()

    const heard = (_event: Electron.Event, favicons: string[]) => {
      // A list that arrives late for the page before this one is not this page's.
      if (favicons.length > 0 && win.webContents.getURL() === url) listed.resolve(favicons)
    }

    win.webContents.on("page-favicon-updated", heard)
    await win.loadURL(url)
    const favicons = await listed.promise
    win.webContents.off("page-favicon-updated", heard)

    return [site, { listed: favicons, icon: describe(await loadIcon(favicons, network)) }] as const
  }

  const results = await [...sites.keys()].reduce<Promise<(readonly [string, object])[]>>(
    async (done, site) => [...(await done), await visit(site)],
    Promise.resolve([]),
  )

  process.stdout.write(`${JSON.stringify(Object.fromEntries(results)).replaceAll(origin, "").replaceAll(host, "//elsewhere")}\n`)
  server.closeAllConnections()
  server.close()
  elsewhere.closeAllConnections()
  elsewhere.close()
  electron.app.quit()
})
