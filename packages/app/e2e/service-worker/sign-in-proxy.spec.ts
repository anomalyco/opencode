import { expect, test, type Page } from "@playwright/test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { once } from "node:events"
import { extname, join, relative, sep } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import { serviceWorker } from "../../vite.pwa"

type Site = {
  url: string
  expire: () => void
  mode: (mode: "reject-api" | "drop-api") => void
  signIns: () => number
}

const fixture = test.extend<{ site: Site }, { app: Record<string, Buffer> }>({
  app: [
    async ({}, use) => {
      const root = await mkdtemp(join(tmpdir(), "opencode-sign-in-proxy-"))
      const outDir = join(root, "dist")
      try {
        await writeFile(
          join(root, "index.html"),
          `<html><head></head><body><h1>Loading</h1><output></output><script type="module" src="/main.js"></script></body></html>`,
        )
        await writeFile(
          join(root, "main.js"),
          `import { fetchThroughSignInProxy } from "sign-in-proxy"
          const probes = []
          const nativeFetch = window.fetch
          window.fetch = (input, init) => {
            const pending = nativeFetch(input, init)
            if (input === "/api/info") probes.push(pending.catch(() => undefined))
            return pending
          }
          // Resolves after every sign-in check this page started has settled and been acted on.
          window.probesSettled = async () => {
            await Promise.all(probes)
            await new Promise((resolve) => setTimeout(resolve))
            return probes.length
          }
          document.querySelector("h1").textContent = "App"
          navigation.addEventListener("navigate", () => (document.querySelector("h1").textContent = "Leaving"))
          fetchThroughSignInProxy("/api/session").then(
            async (response) => (document.querySelector("output").textContent = (await response.json()).version),
            () => (document.querySelector("output").textContent = "failed"),
          )`,
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
          build: { outDir, assetsDir: "_assets" },
          plugins: serviceWorker(outDir),
        })
        const files = await readdir(outDir, { recursive: true, withFileTypes: true })
        await use(
          Object.fromEntries(
            await Promise.all(
              files
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                  const path = join(entry.parentPath, entry.name)
                  return ["/" + relative(outDir, path).split(sep).join("/"), await readFile(path)] as const
                }),
            ),
          ),
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    { scope: "worker" },
  ],
  site: async ({ app }, use) => {
    // Models Dev Tunnels: every path needs a session cookie, sign-in happens on another origin, and it
    // returns through /auth/postback on the app origin, which sets the cookie and redirects to rd.
    const state = { session: 1, signIns: 0, mode: "normal" }
    const login = await listen(
      createServer((request, response) => {
        const postback = new URL(request.url ?? "/", "http://localhost").searchParams.get("pb") ?? ""
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Sign in</title><a href="${postback}">Sign in</a>`)
      }),
    )
    const site = await listen(
      createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        response.setHeader("cache-control", "no-store")
        const api = url.pathname.startsWith("/api/")
        if (api && state.mode === "drop-api") return void request.socket.destroy()
        if (url.pathname === "/auth/postback") {
          state.signIns++
          return void response
            .writeHead(302, {
              location: url.searchParams.get("rd") ?? "/",
              "set-cookie": `session=${state.session}; Path=/; HttpOnly`,
            })
            .end()
        }
        const signedIn = request.headers.cookie?.split("; ").includes(`session=${state.session}`)
        if (!signedIn || (api && state.mode === "reject-api")) {
          const postback = `${site.url}/auth/postback?rd=${encodeURIComponent(url.pathname + url.search)}`
          return void response
            .writeHead(302, { location: `${login.url}/login?pb=${encodeURIComponent(postback)}` })
            .end()
        }
        if (url.pathname === "/api/session")
          return void response.writeHead(200, { "content-type": "application/json" }).end(`{"version":"signed in"}`)
        const file = app[url.pathname]
        const types: Record<string, string> = { ".js": "text/javascript", ".html": "text/html" }
        response.setHeader("content-type", types[extname(url.pathname)] ?? "application/octet-stream")
        if (file) return void response.end(file)
        if (extname(url.pathname)) return void response.writeHead(404).end("Not found")
        response.setHeader("content-type", "text/html")
        response.end(app["/index.html"])
      }),
    )
    try {
      await use({
        url: site.url,
        expire: () => {
          state.session++
        },
        mode: (mode) => {
          state.mode = mode
        },
        signIns: () => state.signIns,
      })
    } finally {
      await Promise.all([site.close(), login.close()])
    }
  },
})

async function listen(server: Server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

async function signIn(page: Page) {
  await expect(page).toHaveTitle("Sign in")
  await page.getByRole("link", { name: "Sign in" }).click()
}

async function install(page: Page, url: string) {
  await page.goto(url)
  await signIn(page)
  await expect(page.getByRole("status")).toHaveText("signed in")
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated")
  await expect(page.getByRole("status")).toHaveText("signed in")
}

function settledProbes(page: Page) {
  return page.evaluate<number>("window.probesSettled()")
}

fixture("sends the cached app back through the sign-in proxy when its session expires", async ({ page, site }) => {
  await install(page, site.url)
  site.expire()
  await page.goto(`${site.url}/workspace/open`)
  await signIn(page)
  await expect(page).toHaveURL(`${site.url}/workspace/open?reauth=1`)
  await expect(page.getByRole("status")).toHaveText("signed in")
  expect(site.signIns()).toBe(2)
})

fixture("does not navigate again when API requests still fail after sign-in", async ({ page, site }) => {
  await install(page, site.url)
  site.expire()
  site.mode("reject-api")
  await page.goto(`${site.url}/workspace/open`)
  await signIn(page)
  await expect(page).toHaveURL(`${site.url}/workspace/open?reauth=1`)
  await expect(page.getByRole("status")).toHaveText("failed")
  expect(await settledProbes(page)).toBe(0)
  await expect(page.getByRole("heading")).toHaveText("App")
  expect(site.signIns()).toBe(2)
})

fixture("stays on the cached app when API requests fail without a redirect", async ({ page, site }) => {
  await install(page, site.url)
  site.mode("drop-api")
  await page.goto(`${site.url}/workspace/offline`)
  await expect(page.getByRole("status")).toHaveText("failed")
  expect(await settledProbes(page)).toBe(1)
  await expect(page.getByRole("heading")).toHaveText("App")
  await expect(page).toHaveURL(`${site.url}/workspace/offline`)
})
