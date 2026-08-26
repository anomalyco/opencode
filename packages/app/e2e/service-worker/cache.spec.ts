import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { once } from "node:events"

const legacy = `
self.addEventListener("install", event => event.waitUntil(
  caches.open("workbox-precache-v2-" + self.registration.scope).then(cache =>
    cache.addAll(["/index.html", "/assets/app-old.js", "/assets/lazy-old.js"])
  )
))
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate") {
    event.respondWith(caches.match("/index.html"))
    return
  }
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)))
})
`

const fixture = test.extend<{ site: { url: string; upgrade: () => void; repair: () => void } }>({
  site: async ({}, use) => {
    const worker = await readFile(new URL("../../dist/sw.js", import.meta.url), "utf8")
    const state = { version: "old", repaired: false }
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname
      const prefix = state.version === "old" ? "/assets" : "/_assets"
      response.setHeader("cache-control", "no-store")
      if (pathname === "/sw.js") {
        response.setHeader("content-type", "text/javascript")
        response.end(state.version === "old" ? legacy : worker)
        return
      }
      if (pathname === `${prefix}/app-${state.version}.js`) {
        response.setHeader("content-type", "text/javascript")
        response.end(`import "${prefix}/startup-${state.version}.js"`)
        return
      }
      if (pathname === `${prefix}/startup-${state.version}.js`) {
        response.setHeader("content-type", "text/javascript")
        response.end(`
          document.getElementById("root").innerHTML = '<h1>${state.version}</h1><label>Draft<input></label><button>Load older chunk</button><output></output>'
          document.querySelector("button").onclick = () => import("/assets/lazy-old.js")
        `)
        return
      }
      if (
        (pathname === "/assets/lazy-old.js" && state.version === "old") ||
        (pathname === "/_assets/retry.js" && state.repaired)
      ) {
        response.setHeader("content-type", "text/javascript")
        response.end('document.querySelector("output").textContent = "Older chunk loaded"')
        return
      }
      // Deliberately retain the old server's fallback so the worker must reject HTML asset responses itself.
      response.setHeader("content-type", "text/html")
      response.end(`<div id="root"></div><script type="module" src="${prefix}/app-${state.version}.js"></script>`)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected a TCP address")
    try {
      await use({
        url: `http://127.0.0.1:${address.port}`,
        upgrade: () => (state.version = "new"),
        repair: () => (state.repaired = true),
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  },
})

fixture("updates a legacy worker without reloading drafts or deleting old chunks", async ({ page, site }) => {
  await page.goto(site.url)
  await expect(page.getByRole("heading")).toHaveText("old")
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })
  await page.goto(site.url)
  await expect(page.getByRole("heading")).toHaveText("old")
  await page.getByLabel("Draft").fill("Keep this unsent prompt")

  site.upgrade()
  await page.evaluate(async () => {
    const cache = await caches.open("opencode-assets")
    await cache.put(
      "/_assets/startup-new.js",
      new Response("<html>stale fallback</html>", {
        headers: { "content-type": "text/html" },
      }),
    )
    const changed = new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }),
    )
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error("Missing legacy worker")
    await registration.update()
    await changed
  })

  await expect(page.getByLabel("Draft")).toHaveValue("Keep this unsent prompt")
  await page.getByRole("button", { name: "Load older chunk" }).click()
  await expect(page.getByRole("status")).toHaveText("Older chunk loaded")

  await page.goto(`${site.url}/workspace/example`)
  await expect(page.getByRole("heading")).toHaveText("new")
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await (await caches.open("opencode-assets")).match("/_assets/startup-new.js"))?.headers.get("content-type"),
      ),
    )
    .toBe("text/javascript")
})

fixture("does not cache HTML responses under asset URLs", async ({ page, site }) => {
  site.upgrade()
  await page.goto(site.url)
  await expect(page.getByRole("heading")).toHaveText("new")
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })
  await page.goto(site.url)
  await expect(page.getByRole("heading")).toHaveText("new")
  expect(await page.evaluate(async () => (await fetch("/_assets/retry.js")).headers.get("content-type"))).toBe(
    "text/html",
  )
  site.repair()
  expect(await page.evaluate(async () => (await fetch("/_assets/retry.js")).headers.get("content-type"))).toBe(
    "text/javascript",
  )
})
