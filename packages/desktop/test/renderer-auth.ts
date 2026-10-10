import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { app, BrowserWindow, protocol } from "electron"
import { SidecarCredentials } from "../src/main/service/sidecar-credentials"
import { registerRendererScheme } from "../src/main/windows/scheme"
import { wireRendererHeaders } from "../src/main/windows/security"

// Exercise Chromium's URL filter without requiring a real Tailscale interface or DNS.
app.commandLine.appendSwitch("host-resolver-rules", "MAP sidecar.test 127.0.0.1, MAP other.test 127.0.0.1")
app.commandLine.appendSwitch("no-proxy-server")
app.setPath("userData", process.env.SMOKE_ROOT!)
registerRendererScheme()
setTimeout(() => app.exit(1), 20_000).unref()

async function main() {
  const expected = `Basic ${Buffer.from("opencode:test-password").toString("base64")}`
  const server = createServer((request, response) => {
    if (request.url === "/page") {
      response.setHeader("content-type", "text/html")
      response.end("<!doctype html><html><body>Untrusted page</body></html>")
      return
    }
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    if (request.url === "/api/experimental/migration/v1") {
      response.statusCode = request.headers.authorization === expected ? 200 : 401
      response.end(JSON.stringify({ status: response.statusCode === 200 ? "completed" : "unauthorized" }))
      return
    }
    response.end(JSON.stringify({ authorization: request.headers.authorization ?? null }))
  })
  await once(server.listen(0, "127.0.0.1"), "listening")
  const address = server.address()
  assert(address && typeof address !== "string")
  const origin = `http://sidecar.test:${address.port}`
  const other = `http://other.test:${address.port}`
  SidecarCredentials.set({ url: origin, password: "test-password" })

  await app.whenReady()
  protocol.handle("oc", () => new Response("<!doctype html><html><body>Renderer</body></html>"))
  const win = new BrowserWindow({ show: false })
  wireRendererHeaders(win)
  await win.loadURL("oc://renderer/index.html")

  assert.deepEqual(
    await win.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + "/api/experimental/migration/v1")})
      .then(async response => ({ status: response.status, body: await response.json() }))`),
    { status: 200, body: { status: "completed" } },
    "the startup migration check must authenticate to a non-loopback service",
  )
  assert.deepEqual(
    await win.webContents.executeJavaScript(`fetch(${JSON.stringify(other + "/headers")}).then(r => r.json())`),
    { authorization: null },
    "other origins must not receive the service credential",
  )
  assert.deepEqual(
    await win.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + "/headers")}, {
      headers: { authorization: "Bearer explicit" }
    }).then(r => r.json())`),
    { authorization: "Bearer explicit" },
    "explicit credentials must not be overwritten",
  )
  assert.deepEqual(
    await (await win.webContents.session.fetch(origin + "/headers")).json(),
    { authorization: null },
    "requests without a renderer frame must not receive the service credential",
  )
  assert.deepEqual(
    await win.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement("iframe")
      frame.src = "oc://renderer/child.html"
      frame.onload = () => frame.contentWindow.fetch(${JSON.stringify(origin + "/headers")})
        .then(r => r.json()).then(resolve)
      document.body.append(frame)
    })`),
    { authorization: null },
    "child frames must not receive the service credential",
  )
  await win.loadURL(other + "/page")
  assert.deepEqual(
    await win.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + "/headers")}).then(r => r.json())`),
    { authorization: null },
    "untrusted top-level pages must not receive the service credential",
  )
  win.destroy()
  server.close()
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    app.exit(1)
  },
)
