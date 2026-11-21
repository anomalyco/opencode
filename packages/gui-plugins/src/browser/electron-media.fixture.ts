import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { guardMediaRequests } from "./media-gate"

// The Electron main process of `electron-media.test.ts`, bundled and run by the pinned Electron with fake capture
// devices. It holds a page's getUserMedia with the media gate and prints, as one JSON line, the order in which the gate
// and the session's permission handler were reached. The handler refuses everything: nothing is ever granted.

electron.app.commandLine.appendSwitch("use-fake-device-for-media-stream")

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>media</title>")
})

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false })
  const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "media-gate" } })
  win.contentView.addChildView(view)
  const contents = view.webContents
  const events: string[] = []
  const answers: boolean[] = []

  view.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    events.push(`handler ${permission}`)
    callback(false)
  })
  await contents.loadURL("about:blank")
  const cdp = createCdp(contents)

  const media = guardMediaRequests(cdp, async (ask) => {
    events.push(`gate ${ask.origin} ${ask.mainFrame} ${ask.kinds.join(",")}`)
    // The user takes a moment; nothing may reach Chromium's media stack meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const allowed = answers.shift() ?? false
    events.push(`answered ${allowed}`)

    return allowed
  })

  await cdp.send("Runtime.enable")
  await cdp.send("Page.enable")
  await media.attach()
  await contents.loadURL(`${origin}/`)

  const call = `navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "granted", (error) => error.name)`
  answers.push(false)
  const blocked = await contents.executeJavaScript(call)
  const afterBlock = [...events]
  events.length = 0
  answers.push(true)
  const released = await contents.executeJavaScript(call)

  const legacy = await contents.executeJavaScript(
    `new Promise((resolve) => navigator.webkitGetUserMedia ? navigator.webkitGetUserMedia({ video: true }, () => resolve("granted"), (error) => resolve(error.name)) : resolve("none"))`,
  )

  process.stdout.write(`${JSON.stringify({ origin, blocked, afterBlock, released, afterRelease: events, legacy })}\n`)
  media.dispose()
  server.close()
  electron.app.quit()
})
