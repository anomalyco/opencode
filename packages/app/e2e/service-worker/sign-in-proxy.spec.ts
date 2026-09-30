import { expect, test, type Page } from "@playwright/test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { once } from "node:events"
import { extname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import { serviceWorker } from "../../vite.pwa"

type Site = { url: string; session: number; rejectApi: boolean }

const fixture = test.extend<{ site: Site }, { dist: string }>({
  dist: [
    async ({}, use) => {
      const root = await mkdtemp(join(tmpdir(), "opencode-sign-in-proxy-"))
      try {
        await writeFile(
          join(root, "index.html"),
          `<h1>App</h1><output></output><script type="module" src="/main.js"></script>`,
        )
        await writeFile(
          join(root, "main.js"),
          `import { fetchThroughSignInProxy } from "sign-in-proxy"
        const probes = []
        const nativeFetch = window.fetch
        window.fetch = (input, init) => {
          const pending = nativeFetch(input, init)
          if (input === "/api/info") probes.push(pending.catch(() => {}))
          return pending
        }
        // Resolves after every sign-in check has settled; the app's handler for each check runs first.
        window.probes = () => Promise.all(probes).then(() => probes.length)
        navigation.addEventListener("navigate", () => (document.querySelector("h1").textContent = "Leaving"))
        fetchThroughSignInProxy("/api/session")
          .then((response) => response.json(), () => "failed")
          .then((text) => (document.querySelector("output").textContent = text))`,
        )
        await build({
          configFile: false,
          root,
          logLevel: "silent",
          resolve: {
            alias: {
              "sign-in-proxy": fileURLToPath(new URL("../../src/runtime/platform/sign-in-proxy.ts", import.meta.url)),
            },
          },
          build: { outDir: "dist", assetsDir: "_assets" },
          plugins: serviceWorker(join(root, "dist")),
        })
        await use(join(root, "dist"))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    { scope: "worker" },
  ],
  site: async ({ dist }, use) => {
    // Models Dev Tunnels: every path needs a cookie, sign-in happens on another origin (localhost instead of
    // 127.0.0.1), and it returns through /auth/postback, which sets the cookie and redirects to rd.
    const site = { url: "", session: 1, rejectApi: false }
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
      const rd = encodeURIComponent(url.searchParams.get("rd") ?? url.pathname + url.search)
      if (url.hostname === "localhost")
        return void response
          .writeHead(200, { "content-type": "text/html" })
          .end(`<a href="${site.url}/auth/postback?rd=${rd}">Sign in</a>`)
      if (url.pathname === "/auth/postback")
        return void response
          .writeHead(302, {
            location: url.searchParams.get("rd") ?? "/",
            "set-cookie": `session=${site.session}; Path=/`,
          })
          .end()
      const api = url.pathname.startsWith("/api/")
      if (request.headers.cookie !== `session=${site.session}` || (api && site.rejectApi))
        return void response
          .writeHead(302, { location: `${site.url.replace("127.0.0.1", "localhost")}/?rd=${rd}` })
          .end()
      if (api) return void response.writeHead(200, { "content-type": "application/json" }).end(`"signed in"`)
      const file = await readFile(join(dist, extname(url.pathname) ? url.pathname : "index.html")).catch(
        () => undefined,
      )
      if (!file) return void response.writeHead(404).end()
      response
        .writeHead(200, { "content-type": url.pathname.endsWith(".js") ? "text/javascript" : "text/html" })
        .end(file)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    site.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await use(site)
    server.closeAllConnections()
    server.close()
  },
})

async function signIn(page: Page) {
  await page.getByRole("link", { name: "Sign in" }).click()
}

async function install(page: Page, site: Site) {
  await page.goto(site.url)
  await signIn(page)
  await expect(page).toHaveURL(`${site.url}/`)
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated")
  await expect(page.getByRole("status")).toHaveText("signed in")
}

function probes(page: Page) {
  return page.evaluate<number>("window.probes()")
}

fixture("sends the cached app through sign-in when the proxy session expires", async ({ page, site }) => {
  await install(page, site)
  site.session++
  await page.goto(`${site.url}/workspace`)
  await signIn(page)
  await expect(page).toHaveURL(`${site.url}/workspace?reauth=1`)
  await expect(page.getByRole("status")).toHaveText("signed in")
})

fixture("tries once while the proxy keeps rejecting API requests", async ({ page, site }) => {
  await install(page, site)
  site.session++
  site.rejectApi = true
  await page.goto(`${site.url}/workspace`)
  await signIn(page)
  await expect(page).toHaveURL(`${site.url}/workspace?reauth=1`)
  await expect(page.getByRole("status")).toHaveText("failed")
  expect(await probes(page)).toBe(0)
  await expect(page.getByRole("heading")).toHaveText("App")
})

fixture("stays on the cached app when the network is down", async ({ page, context, site }) => {
  await install(page, site)
  await context.setOffline(true)
  await page.goto(`${site.url}/workspace`)
  await expect(page.getByRole("status")).toHaveText("failed")
  expect(await probes(page)).toBe(1)
  await expect(page.getByRole("heading")).toHaveText("App")
})
