import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { attachChildren, releaseWorker } from "./child-targets"

// The Electron main process of `electron-workers.test.ts`, bundled and run by the pinned Electron. It guards a page's
// child targets as a pane tab does and prints, as one JSON line, which of the page's workers started.

const scripts = [
  ["/worker.js", `postMessage("worker")`],
  ["/outer.js", `const inner = new Worker("/inner.js"); inner.onmessage = (event) => postMessage(event.data)`],
  ["/inner.js", `postMessage("nested")`],
] as const

const page = `<!doctype html><title>workers</title><script>
const seen = []
const report = (name) => { seen.push(name); document.title = seen.sort().join(",") }
new Worker("/worker.js").onmessage = (event) => report(event.data)
new Worker("/outer.js").onmessage = (event) => report(event.data)
</script>`

const server = createServer((request, response) => {
  const script = scripts.find(([path]) => path === request.url)?.[1]
  response.writeHead(200, {
    "content-type": script ? "text/javascript" : "text/html",
    "x-content-type-options": "nosniff",
  })
  response.end(script ?? page)
})

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const win = new electron.BrowserWindow({ show: false })
  const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } })
  win.contentView.addChildView(view)
  const contents = view.webContents
  const cdp = createCdp(contents)

  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    if (targetInfo.type === "worker") void releaseWorker(cdp, sessionId)
  })
  await attachChildren(cdp)
  await contents.loadURL(`http://127.0.0.1:${address instanceof Object ? address.port : 0}/`)

  const deadline = Date.now() + 10_000

  while (contents.getTitle() !== "nested,worker" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))

  console.log(JSON.stringify({ started: contents.getTitle() }))
  server.close()
  electron.app.exit(0)
})
