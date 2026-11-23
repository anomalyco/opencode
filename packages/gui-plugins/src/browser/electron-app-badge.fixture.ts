import { createServer } from "node:http"
import electron from "electron"
import { createExtensionHost } from "./profile/extension-api/host"
import { createManifests } from "./profile/extension-api/manifest"

// The Electron main process of `electron-app-badge.test.ts`, bundled and run by the pinned Electron. A page of a
// partition without the profile's preload sets the app's badge to 7. Then a page of a partition with it, a child
// frame of that page and its service worker each ask for another number, and the page clears the badge. It prints
// the app's badge count after each as one JSON line.

const child = `<!doctype html><script>navigator.setAppBadge(4).then(() => parent.postMessage("frame", "*"))</script>`

const script = `onmessage = (event) => navigator.setAppBadge(5).then(() => event.source.postMessage("worker"))`

const page = `<!doctype html><title>page</title><body><script>
const heard = (target) => new Promise((resolve) => target.addEventListener("message", (event) => resolve(event.data), { once: true }))
const frame = () => {
  const reply = heard(window)
  document.body.append(Object.assign(document.createElement("iframe"), { src: "/frame" }))
  return reply
}
const worker = async () => {
  await navigator.serviceWorker.register("/worker.js")
  const registration = await navigator.serviceWorker.ready
  const reply = heard(navigator.serviceWorker)
  registration.active.postMessage("badge")
  return reply
}
</script>`

const server = createServer((request, response) => {
  const worker = request.url === "/worker.js"
  response.writeHead(200, { "content-type": worker ? "text/javascript" : "text/html" })
  response.end(worker ? script : request.url === "/frame" ? child : page)
})

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false })

  // A page as the pane opens one for a server on this machine (`createBrowserPage`), in a partition kept on disk as
  // the profile's is: Electron answers the badge calls of no other kind of partition.
  const open = async (partition: string) => {
    const view = new electron.WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true },
    })

    win.contentView.addChildView(view)
    await view.webContents.loadURL(origin)

    return view.webContents
  }

  const host = await createExtensionHost({
    session: electron.session.fromPartition("persist:profile"),
    directory: electron.app.getPath("userData"),
    modules: [],
    log: { write: () => undefined },
    manifest: createManifests(),
  })

  const plain = await open("persist:plain")
  await plain.executeJavaScript("navigator.setAppBadge(7)")
  // Main hears of a badge a moment after the page hears its call resolve.
  const deadline = Date.now() + 10_000

  while (electron.app.getBadgeCount() !== 7 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20))

  const unguarded = electron.app.getBadgeCount()
  const profile = await open("persist:profile")

  // The app's count once the profile's page, frame or worker heard its own call resolve. The page's answer can
  // overtake a badge on its way to main, so one more round trip to the page goes first. A frame's badge can take
  // longer still, and then shows in the next count.
  const after = async (call: string) => {
    await profile.executeJavaScript(call)
    await profile.executeJavaScript("0")

    return electron.app.getBadgeCount()
  }

  const result = {
    unguarded,
    page: await after("navigator.setAppBadge(3)"),
    frame: await after("frame()"),
    worker: await after("worker()"),
    cleared: await after("navigator.clearAppBadge()"),
  }

  console.log(JSON.stringify(result))
  host.dispose()
  server.close()
  electron.app.exit(0)
})
