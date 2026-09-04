import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { once } from "node:events"

// The stripped-down headless shell disables native notifications. Use full Chromium.
test.use({ channel: "chromium", permissions: ["notifications"] })

test("push wakes a stopped worker after every app page closes", async ({ context }) => {
  const script = await readFile(new URL("../../public/push-sw.js", import.meta.url))
  const server = createServer((request, response) => {
    if (request.url === "/push-sw.js") {
      response.writeHead(200, { "content-type": "text/javascript" }).end(script)
      return
    }
    response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Worker test setup</title>")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP address")
  const origin = `http://127.0.0.1:${address.port}`
  const scope = "/push/aHR0cDovL2xvY2FsaG9zdDo0MDk2/"

  try {
    // An about:blank inspector keeps the CDP connection, not an app page or event stream.
    const inspector = await context.newPage()
    const cdp = await context.newCDPSession(inspector)
    const registrations = new Map<string, string>()
    const versions = new Map<string, { versionId: string; runningStatus: string }>()
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations: items }) => {
      items.forEach((item) => registrations.set(item.scopeURL, item.registrationId))
    })
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: items }) => {
      items.forEach((item) => versions.set(item.registrationId, item))
    })
    await cdp.send("ServiceWorker.enable")
    const page = await context.newPage()
    await page.goto(origin)
    await page.evaluate(async (scope) => {
      const registration = await navigator.serviceWorker.register("/push-sw.js", { scope })
      const worker = registration.installing ?? registration.waiting ?? registration.active
      if (!worker) throw new Error("Missing push worker")
      if (worker.state === "activated") return
      await new Promise<void>((resolve) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve()
        })
      })
    }, scope)
    await expect.poll(() => registrations.get(origin + scope)).toBeDefined()
    const registrationId = registrations.get(origin + scope)!
    await expect.poll(() => versions.get(registrationId)?.runningStatus).toBe("running")
    await page.close()
    await cdp.send("ServiceWorker.stopWorker", { versionId: versions.get(registrationId)!.versionId })
    await expect.poll(() => versions.get(registrationId)?.runningStatus).toBe("stopped")
    expect(context.pages().map((page) => page.url())).toEqual(["about:blank"])

    const payload = {
      title: "Response ready",
      body: "Closed PWA integration test",
      url: `${origin}/server/aHR0cDovL2xvY2FsaG9zdDo0MDk2/session/ses_push_test`,
      tag: "evt_push_test",
    }
    // Inject at the browser's decoded-push boundary; this does not verify an external push provider.
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify(payload) })
    await expect.poll(() => versions.get(registrationId)?.runningStatus).toBe("running")
    const check = await context.newPage()
    await check.goto(origin)
    await expect
      .poll(() =>
        check.evaluate(async (scope) => {
          const registration = await navigator.serviceWorker.getRegistration(scope)
          const notifications = await registration?.getNotifications()
          return notifications?.map((item) => ({
            title: item.title,
            body: item.body,
            tag: item.tag,
            data: item.data,
          }))
        }, scope),
      )
      .toEqual([{ title: payload.title, body: payload.body, tag: payload.tag, data: { url: payload.url } }])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
