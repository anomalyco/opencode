import { expect, test, type Page } from "@playwright/test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { join, extname, relative, sep } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import { serviceWorker } from "../../vite.pwa"

type Site = {
  url: string
  deploy: (fault?: "failed" | "html" | "corrupt" | "mixed-html" | "blocked") => void
  legacy: () => void
  requests: string[]
  release: () => void
}

const fixture = test.extend<{ site: Site }, { builds: Record<string, Record<string, Buffer>> }>({
  builds: [
    async ({}, use) => {
      const directory = await mkdtemp(join(tmpdir(), "opencode-precache-"))
      const builds: Record<string, Record<string, Buffer>> = {}
      try {
        for (const version of ["old", "new"]) {
          const root = join(directory, version)
          const outDir = join(root, "dist")
          await mkdir(join(root, "public", "nested"), { recursive: true })
          await Promise.all(
            Object.entries({
              "index.html": `<html><head></head><body><h1>Loading</h1><label>Draft<textarea></textarea></label><button>Load lazy</button><output></output><script type="module" src="/main.js"></script></body></html>`,
              "main.js": `document.querySelector("h1").textContent = "${version}";
            document.querySelector("button").onclick = async () => {
              document.querySelector("output").textContent = await (await import("./lazy.js")).load()
            };`,
              "lazy.js": `export async function load() { return (await import("./nested.js")).value }`,
              "nested.js": `export const value = "${version} nested lazy loaded"`,
              "public/nested/data.json": JSON.stringify({ version }),
              "public/nested/font.woff2": `font-${version}`,
              "public/nested/module.wasm": Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
              "public/large.bin": Buffer.alloc(2 * 1024 * 1024 + 1, version === "old" ? 1 : 2),
              "public/_headers": "/*\n  Cache-Control: no-cache",
              "public/_redirects": "/* /index.html 200",
            }).map(([path, contents]) => writeFile(join(root, path), contents)),
          )
          await build({
            configFile: false,
            root,
            logLevel: "silent",
            build: { outDir, assetsDir: "_assets", sourcemap: true },
            plugins: serviceWorker(outDir),
          })
          builds[version] = Object.fromEntries(
            await Promise.all(
              (await readdir(outDir, { recursive: true, withFileTypes: true }))
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                  const path = join(entry.parentPath, entry.name)
                  return ["/" + relative(outDir, path).split(sep).join("/"), await readFile(path)]
                }),
            ),
          )
        }
        await use(builds)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    { scope: "worker" },
  ],
  site: async ({ builds }, use) => {
    const state = { version: "old", fault: "", legacy: false }
    const requests: string[] = []
    const blocked: ServerResponse[] = []
    const release = () => blocked.splice(0).forEach((response) => response.end(builds.new["/large.bin"]))
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname
      requests.push(path)
      response.setHeader("cache-control", "no-store")
      if (path === "/observer.html")
        return void response.writeHead(200, { "content-type": "text/html" }).end("<title>Worker observer</title>")
      if (path === "/api/health")
        return void response.writeHead(200, { "content-type": "application/json" }).end('{"healthy":true}')
      if (path === "/sw.js" && state.legacy && state.version === "old") {
        // Model the shipped worker's shared precache name and cache-first navigation behavior.
        const urls = Object.keys(builds.old).filter(
          (path) => path === "/index.html" || (path.startsWith("/_assets/") && path.endsWith(".js")),
        )
        response.setHeader("content-type", "text/javascript")
        return void response.end(`
          self.addEventListener("install", event => event.waitUntil(
            caches.open("workbox-precache-v2-" + self.registration.scope).then(cache => cache.addAll(${JSON.stringify(urls)}))
          ));
          self.addEventListener("fetch", event => event.respondWith(
            caches.match(event.request.mode === "navigate" ? "/index.html" : event.request)
              .then(response => response || fetch(event.request))
          ));
        `)
      }
      if (path === "/index.html" && state.fault === "mixed-html")
        return void response.writeHead(200, { "content-type": "text/html" }).end(builds.old["/index.html"])
      if (path === "/large.bin" && state.fault && state.fault !== "mixed-html") {
        if (state.fault === "blocked") return void blocked.push(response)
        if (state.fault === "failed") return void response.writeHead(503).end("Unavailable")
        if (state.fault === "html")
          return void response.writeHead(200, { "content-type": "text/html" }).end("<html>Wrong fallback</html>")
        return void response.end("Incorrect bytes with a successful status")
      }
      const file = builds[state.version][path]
      const types: Record<string, string> = {
        ".js": "text/javascript",
        ".html": "text/html",
        ".json": "application/json",
        ".wasm": "application/wasm",
      }
      response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream")
      if (file) return void response.end(file)
      if (extname(path)) return void response.writeHead(404).end("Not found")
      response.setHeader("content-type", "text/html")
      response.end(builds[state.version]["/index.html"])
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected a TCP address")
    try {
      await use({
        url: `http://127.0.0.1:${address.port}`,
        deploy: (fault = undefined) => {
          state.version = "new"
          state.fault = fault ?? ""
        },
        legacy: () => {
          state.legacy = true
        },
        requests,
        release,
      })
    } finally {
      release()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  },
})

async function install(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByRole("heading")).toHaveText("old")
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated")
  await expect(page.getByRole("heading")).toHaveText("old")
}

async function update(page: Page) {
  return page.evaluateHandle(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error("Missing installed worker")
    const found = new Promise<ServiceWorker>((resolve) =>
      registration.addEventListener(
        "updatefound",
        () => {
          if (!registration.installing) throw new Error("Missing installing worker")
          resolve(registration.installing)
        },
        { once: true },
      ),
    )
    await registration.update()
    return found
  })
}

async function waiting(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state))
    .toBe("installed")
}

fixture(
  "opens an uncached route offline and executes never-used nested lazy chunks",
  async ({ page, context, site }) => {
    await install(page, site.url)
    await expect(page.getByRole("status")).toBeEmpty()
    await context.setOffline(true)
    await page.goto(`${site.url}/workspace/never-visited`)
    await expect(page.getByRole("heading")).toHaveText("old")
    await page.getByRole("button", { name: "Load lazy" }).click()
    await expect(page.getByRole("status")).toHaveText("old nested lazy loaded")
  },
)

fixture(
  "precaches public files of every type and size, excluding deployment metadata and source maps",
  async ({ page, site, builds, context }) => {
    await install(page, site.url)
    const files = ["/nested/data.json", "/nested/font.woff2", "/nested/module.wasm", "/large.bin"]
    await context.setOffline(true)
    for (const path of files) {
      const digest = await page.evaluate(
        async (path) =>
          Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await (await fetch(path)).arrayBuffer()))),
        path,
      )
      expect(Buffer.from(digest)).toEqual(createHash("sha256").update(builds.old[path]).digest())
    }
    expect(site.requests).not.toContain("/_headers")
    expect(site.requests).not.toContain("/_redirects")
    expect(site.requests.filter((path) => path.endsWith(".map"))).toEqual([])
  },
)

fixture(
  "keeps drafts and removed old lazy chunks until every controlled tab closes",
  async ({ page, context, site, builds }) => {
    await install(page, site.url)
    const second = await context.newPage()
    await second.goto(site.url)
    await expect(second.getByRole("heading")).toHaveText("old")
    await second.getByLabel("Draft").fill("Keep this unsent prompt")

    site.deploy()
    const created = context.waitForEvent("serviceworker")
    const worker = await update(page)
    const replacement = await created
    await waiting(page)
    expect(await worker.evaluate((worker) => worker.state)).toBe("installed")
    await expect(second.getByLabel("Draft")).toHaveValue("Keep this unsent prompt")
    await page.close()
    await waiting(second)
    await expect(second.getByRole("heading")).toHaveText("old")
    await expect(second.getByLabel("Draft")).toHaveValue("Keep this unsent prompt")

    const removed = Object.keys(builds.old).find((path) => path.includes("/nested-") && path.endsWith(".js"))
    expect(removed).toBeDefined()
    expect((await second.request.get(`${site.url}${removed}`)).status()).toBe(404)
    await second.getByRole("button", { name: "Load lazy" }).click()
    await expect(second.getByRole("status")).toHaveText("old nested lazy loaded")
    await expect(second.getByLabel("Draft")).toHaveValue("Keep this unsent prompt")
    await second.close()

    await expect
      .poll(() =>
        replacement.evaluate(() => {
          const registration = (self as unknown as { registration: ServiceWorkerRegistration }).registration
          return { waiting: !!registration.waiting, active: registration.active?.state }
        }),
      )
      .toEqual({ waiting: false, active: "activated" })
    await context.setOffline(true)
    const observer = await context.newPage()
    await observer.goto(`${site.url}/workspace/reopened`)
    await expect(observer.getByRole("heading")).toHaveText("new")
    await observer.getByRole("button", { name: "Load lazy" }).click()
    await expect(observer.getByRole("status")).toHaveText("new nested lazy loaded")
  },
)

for (const fault of ["failed", "html", "corrupt", "mixed-html"] as const) {
  fixture(`retains the old complete build when a precache download is ${fault}`, async ({ page, context, site }) => {
    await install(page, site.url)
    await page.getByLabel("Draft").fill("Still editing")
    site.deploy(fault)
    const worker = await update(page)
    await expect.poll(() => worker.evaluate((worker) => worker.state)).toBe("redundant")
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting)).toBeNull()
    await expect(page.getByLabel("Draft")).toHaveValue("Still editing")
    await context.setOffline(true)
    await page.goto(`${site.url}/workspace/after-failure`)
    await expect(page.getByRole("heading")).toHaveText("old")
    await page.getByRole("button", { name: "Load lazy" }).click()
    await expect(page.getByRole("status")).toHaveText("old nested lazy loaded")
  })
}

fixture("does not expose new HTML while a precache download is blocked", async ({ page, context, site }) => {
  await install(page, site.url)
  site.requests.length = 0
  site.deploy("blocked")
  const worker = await update(page)
  await expect.poll(() => site.requests.includes("/large.bin")).toBe(true)
  expect(await worker.evaluate((worker) => worker.state)).toBe("installing")
  const second = await context.newPage()
  await second.goto(`${site.url}/workspace/during-install`)
  await expect(second.getByRole("heading")).toHaveText("old")
  site.release()
  await waiting(page)
  await second.reload()
  await expect(second.getByRole("heading")).toHaveText("old")
})

fixture("upgrades the legacy shared precache only after old tabs close", async ({ page, context, site, builds }) => {
  site.legacy()
  const observer = await context.newPage()
  await observer.goto(`${site.url}/observer.html`)
  await install(page, site.url)
  await page.getByLabel("Draft").fill("Legacy unsent prompt")
  // A stale runtime-cache HTML response must not contaminate the new generated precache.
  const entry = Object.keys(builds.new).find((path) => path.includes("/index-") && path.endsWith(".js"))
  expect(entry).toBeDefined()
  await page.evaluate(async (entry) => {
    await (
      await caches.open("opencode-assets")
    ).put(entry!, new Response("<html>stale fallback</html>", { headers: { "content-type": "text/html" } }))
  }, entry)
  site.deploy()
  await update(page)
  await waiting(page)
  await expect(page.getByLabel("Draft")).toHaveValue("Legacy unsent prompt")
  await page.getByRole("button", { name: "Load lazy" }).click()
  await expect(page.getByRole("status")).toHaveText("old nested lazy loaded")
  await page.close()
  await expect
    .poll(() => observer.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting))
    .toBe(false)
  await context.setOffline(true)
  await observer.goto(`${site.url}/workspace/legacy-upgraded`)
  await expect(observer.getByRole("heading")).toHaveText("new")
  await observer.getByRole("button", { name: "Load lazy" }).click()
  await expect(observer.getByRole("status")).toHaveText("new nested lazy loaded")
})

fixture("does not substitute cached HTML for API or missing asset navigations", async ({ page, site }) => {
  await install(page, site.url)
  const api = await page.goto(`${site.url}/api/health`)
  expect(await api?.json()).toEqual({ healthy: true })
  expect(api?.fromServiceWorker()).toBe(false)
  const asset = await page.goto(`${site.url}/_assets/missing.js`)
  expect(asset?.status()).toBe(404)
  expect(await asset?.text()).toBe("Not found")
})

test("the production build precaches every deployable file", async ({ page, context }) => {
  const directory = new URL("../../dist/", import.meta.url)
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => "/" + relative(fileURLToPath(directory), join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.endsWith(".map") && !["/_headers", "/_redirects", "/sw.js"].includes(path))
  expect(files.length).toBeGreaterThan(1)
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname
    response.setHeader("cache-control", "no-store")
    if (path === "/probe.html")
      return void response.writeHead(200, { "content-type": "text/html" }).end("<title>Precache probe</title>")
    const bytes = await readFile(new URL(`.${path}`, directory)).catch(() => undefined)
    if (!bytes) return void response.writeHead(404).end("Not found")
    if (path.endsWith(".js")) response.setHeader("content-type", "text/javascript")
    if (path.endsWith(".html")) {
      response.setHeader("content-type", "text/html")
      // Inspect the real cached HTML without executing the app or contacting a backend.
      response.setHeader("content-security-policy", "default-src 'none'")
    }
    response.end(bytes)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP address")
  const url = `http://127.0.0.1:${address.port}`
  try {
    await page.goto(`${url}/probe.html`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
    })
    const cached = await page.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (name) =>
            (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
          ),
        )
      )
        .flat()
        .sort(),
    )
    expect(cached).toEqual(files.sort())
    await context.setOffline(true)
    const response = await page.goto(`${url}/workspace/offline-probe`)
    expect(response?.fromServiceWorker()).toBe(true)
    expect(await response?.text()).toBe(await readFile(new URL("index.html", directory), "utf8"))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
