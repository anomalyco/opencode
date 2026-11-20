import { createServer } from "node:http"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import { icoSample, pngSample, svgSample, type Pixel } from "./icon-samples"
import type { TabActivity } from "./policy"

// The Electron main process of `electron-icon.test.ts`, bundled and run by the pinned Electron. It opens one pane page
// for each made-up site below, each listing its icon the way real sites do, and prints the icon each tab reported as
// one JSON line: its type and its length as a data URL and, for a PNG, its size in pixels and the color in its middle.

type File = { type: string; body: Buffer | string; status?: number; location?: string }

// A site's page lists its icons; the files beside it are what its server answers.
type Site = { links: readonly string[]; files?: Readonly<Record<string, File>> }

const solid = (...color: readonly [number, number, number]) => (): Pixel => [...color, 255]

// The 16px and 48px images are red and blue, so the color tells which image of the file the tab shows.
const sizes = (bits: 4 | 8 | 32, ...color: readonly [number, number, number]) =>
  icoSample([
    { size: 16, bits, paint: solid(255, 0, 0) },
    { size: 32, bits, paint: solid(...color) },
    { size: 48, bits, paint: solid(0, 0, 255) },
  ])

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
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createHandlePath } = await import("./disk")
  const { loadIcon } = await import("./icon")
  const { createDirectNetwork } = await import("./network")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")

  // Another origin, as a site's static host is.
  const elsewhere = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/x-icon" })
    response.end(sizes(32, 90, 30, 160))
  })

  await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve))
  const other = elsewhere.address()
  const host = `http://127.0.0.1:${other instanceof Object ? other.port : 0}`

  const sites = new Map(Object.entries<Site>({
    // One 16px bitmap, 1,150 bytes: the smallest favicon.ico sites serve.
    small: { links: ["site.ico"], files: { "site.ico": { type: "image/x-icon", body: icoSample([{ size: 16, bits: 32, paint: solid(230, 80, 0) }]) } } },
    // 16, 32 and 48px bitmaps in one 15,086-byte file, the commonest favicon.ico.
    ico: { links: ["site.ico"], files: { "site.ico": { type: "image/x-icon", body: sizes(32, 10, 200, 60) } } },
    // The same with 16 and 256 colors and a mask, as older sites still serve.
    colors16: { links: ["site.ico"], files: { "site.ico": { type: "image/vnd.microsoft.icon", body: sizes(4, 200, 120, 10) } } },
    colors256: { links: ["site.ico"], files: { "site.ico": { type: "image/vnd.microsoft.icon", body: sizes(8, 20, 120, 200) } } },
    // Bitmaps up to 128px and a 256px PNG in one file of about 100 KB, as a site with a desktop shortcut serves.
    icoPng: {
      links: ["site.ico"],
      files: {
        "site.ico": {
          type: "image/x-icon",
          body: icoSample([
            { size: 16, bits: 32, paint: solid(255, 0, 0) },
            { size: 64, bits: 32, paint: solid(150, 40, 220) },
            { size: 128, bits: 32, paint: solid(0, 0, 255) },
            { size: 256, png: pngSample(256, solid(0, 0, 255)) },
          ]),
        },
      },
    },
    // A PNG named .ico, as some sites serve.
    pngAsIco: { links: ["favicon.ico"], files: { "favicon.ico": { type: "image/x-icon", body: pngSample(48, solid(30, 30, 30)) } } },
    touch: { links: ["icon-180.png"], files: { "icon-180.png": { type: "image/png", body: pngSample(180, solid(240, 90, 30)) } } },
    noise: { links: ["icon.png"], files: { "icon.png": { type: "image/png", body: pngSample(32, noise) } } },
    jpeg: {
      links: ["icon.jpg"],
      files: {
        "icon.jpg": { type: "image/jpeg", body: electron.nativeImage.createFromBuffer(pngSample(64, solid(250, 250, 250))).toJPEG(90) },
      },
    },
    // Only an SVG, as a Vite app has by default.
    svg: { links: ["icon.svg"], files: { "icon.svg": { type: "image/svg+xml", body: svgSample } } },
    // An SVG too long to report, then a 150px bitmap in an .ico file of about 90 KB.
    longSvg: {
      links: ["a.svg", "b.ico"],
      files: {
        "a.svg": { type: "image/svg+xml", body: svgSample.replace("</svg>", `<!--${"x".repeat(30_000)}--></svg>`) },
        "b.ico": { type: "image/x-icon", body: icoSample([{ size: 150, bits: 32, paint: solid(180, 0, 60) }]) },
      },
    },
    // Chromium lists a page's icons by address, so the vector one comes first here.
    svgThenPng: {
      links: ["a.svg", "b.png"],
      files: { "a.svg": { type: "image/svg+xml", body: svgSample }, "b.png": { type: "image/png", body: pngSample(32, solid(70, 70, 200)) } },
    },
    inline: { links: [`data:image/png;base64,${pngSample(16, solid(120, 60, 0)).toString("base64")}`] },
    inlineSvg: { links: [`data:image/svg+xml;base64,${Buffer.from(svgSample).toString("base64")}`] },
    // No <link>: Chromium asks for /favicon.ico, which this server has.
    unlisted: { links: [] },
    redirect: { links: ["moved"], files: { moved: { type: "text/plain", body: "", status: 302, location: "/touch/icon-180.png" } } },
    elsewhere: { links: [`${host}/site.ico`] },
    junk: { links: ["site.ico"], files: { "site.ico": { type: "image/x-icon", body: Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37) & 255)) } } },
    // A page where the icon should be, as a single-page app answers every address.
    html: { links: ["site.ico"], files: { "site.ico": { type: "text/html", body: page("Not an icon", []) } } },
    missing: { links: ["site.ico"] },
    huge: { links: ["icon.png"], files: { "icon.png": { type: "image/png", body: pngSample(300, noise) } } },
  }))

  const server = createServer((request, response) => {
    const [, site = "", file = ""] = (request.url ?? "").split("/")

    if (site === "favicon.ico") return void response.writeHead(200, { "content-type": "image/x-icon" }).end(sizes(32, 0, 150, 150))
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
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const verifier = createHandlePath()
  const values = new Map<string, unknown>()

  // SAFETY: the site permissions read only `store` and its `value` and `set`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const storage = {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
      set: (next: unknown) => values.set(key, next),
    }),
  } as unknown as BuiltinMainStorage

  const embeds: Embeds = {
    create(view, window) {
      window.contentView.addChildView(view)
      view.setBounds({ x: 0, y: 0, width: 800, height: 600 })

      return {
        id: "embed",
        show: (visible) => view.setVisible(visible),
        on: () => () => undefined,
        capture: async () => undefined,
        dispose: () => window.contentView.removeChildView(view),
      }
    },
  }

  const signal = new AbortController().signal
  const refs = { next: 0 }
  const permissions = createSitePermissions(storage, () => undefined)
  const system = createSystemMedia()
  const network = createDirectNetwork(electron.session.fromPartition("icon-fixture"))

  const describe = (icon: string | undefined) => {
    if (!icon) return null
    const type = /^data:([^;,]+)/.exec(icon)?.[1] ?? ""

    if (type !== "image/png") return { type, length: icon.length }
    const image = electron.nativeImage.createFromDataURL(icon)
    const size = image.getSize()
    const middle = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
    // Chromium's bitmaps hold blue first.
    const [blue = 0, green = 0, red = 0] = image.toBitmap().subarray(middle, middle + 3)

    return {
      type,
      width: size.width,
      height: size.height,
      length: icon.length,
      color: "#" + [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join(""),
    }
  }

  // Opens a site in a tab of its own and returns the icon the tab reported once Chromium's list for the page was read.
  const visit = async (site: string, index: number) => {
    const id = Browser.TabID.make(`tab_${String(index).padStart(8, "0")}-1111-1111-1111-111111111111`)
    const activity: TabActivity = { agentRuns: 0 }
    const reported: (string | undefined)[] = []
    const arrived = Promise.withResolvers<void>()
    const listed = Promise.withResolvers<readonly string[]>()

    const tab = createBrowserPage(win, {
      id,
      toolbar: false,
      partition: "icon-fixture",
      network,
      publish: () => undefined,
      detail: (value) => {
        reported.push(value.icon)

        if (value.icon) arrived.resolve()
      },
      refused: () => undefined,
      fail: () => undefined,
      popup: () => {
        throw new Error("The fixture page opens no window.")
      },
      activity,
      userInput: () => undefined,
      local: true,
      signal,
      shared: { ref: () => `e${++refs.next}` },
      menu: { t: (key) => key, extensions: () => [], navigate: async () => undefined, open: async () => undefined, verifier },
      embeds,
      sites: permissions,
      system,
    })

    tab.contents.on("page-favicon-updated", (_event, favicons) => {
      if (favicons.length > 0) listed.resolve(favicons)
    })
    await tab.ready
    // Every other tab is the agent's: whoever opens a page, its icon arrives the same way.
    await tab.execute({ action: { type: "navigate", tabID: id, url: `${origin}/${site}/` }, files: [] }, signal, index % 2 ? "agent" : "user")
    const favicons = await listed.promise
    // The same list, loaded again after the tab began loading it: the tab's own answer is in by then, or on its way.
    const loaded = await loadIcon(favicons, network)

    if (loaded) await arrived.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    const icon = reported.at(-1)
    await tab.dispose()

    return [site, { listed: favicons, icon: describe(icon), same: icon === loaded }] as const
  }

  const results = await [...sites.keys()].reduce<Promise<(readonly [string, object])[]>>(
    async (done, site, index) => [...(await done), await visit(site, index)],
    Promise.resolve([]),
  )


  process.stdout.write(`${JSON.stringify(Object.fromEntries(results)).replaceAll(origin, "").replaceAll(host, "//elsewhere")}\n`)
  server.closeAllConnections()
  server.close()
  elsewhere.closeAllConnections()
  elsewhere.close()
  electron.app.quit()
})
