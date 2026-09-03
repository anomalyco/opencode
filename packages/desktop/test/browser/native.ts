import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import path from "node:path"
import { app, BrowserWindow } from "electron"
import { Browser } from "@opencode-ai/schema/browser"
import { OpenCode } from "@opencode-ai/client"
import { Effect, Fiber, Schema, Stream } from "effect"
import { createBrowserPane } from "../../src/main/browser-pane"
import { bindIpcEvents, ipcEventStream } from "../../src/main/ipc-events"
import { Smoke } from "./contract"

type Output<Name extends Browser.Method> = Schema.Schema.Type<Extract<Browser.Operation, { name: Name }>["output"]>

// Fail the disposable fixture in stderr instead of opening Electron's error dialog.
process.on("uncaughtException", (error) => {
  console.error(error)
  app.exit(1)
})
process.on("unhandledRejection", (error) => {
  console.error(error)
  app.exit(1)
})

async function main() {
  const root = process.env.SMOKE_ROOT!
  app.setPath("userData", path.join(root, "electron-data"))
  app.on("window-all-closed", () => {})
  await app.whenReady()
  const web = createServer((request, response) => {
    if (request.url === "/api/test") {
      response.setHeader("content-type", "application/json")
      response.end('{"message":"network body"}')
      return
    }
    if (request.url === "/missing") {
      response.writeHead(404, { "content-type": "text/plain" })
      response.end("not found")
      return
    }
    if (request.url === "/download") {
      response.setHeader("content-disposition", 'attachment; filename="report.txt"')
      response.setHeader("content-type", "text/plain")
      response.end("desktop download bytes")
      return
    }
    if (request.url === "/frame") {
      response.setHeader("content-type", "text/html")
      response.end("<button onclick=\"this.textContent='Frame clicked'\">Frame button</button>")
      return
    }
    response.setHeader("content-type", "text/html")
    response.end(
      `<!doctype html><html lang="en"><head><title>Browser suite</title><meta name="description" content="Native browser test"><style>body{font:16px sans-serif;padding:20px}input,button,select{margin:6px}#space{height:1400px}</style></head><body><h1>Browser suite</h1><label>Name<input aria-label="Name"></label><button onclick="document.querySelector('output').textContent=document.querySelector('input').value">Apply</button><output>Waiting</output><input type="checkbox" aria-label="Remember"><select aria-label="Color"><option value="red">Red</option><option value="blue">Blue</option></select><input type="file" aria-label="Upload"><button onclick="alert('hello dialog')">Dialog</button><a href="/download">Download</a><a href="/frame" target="_blank">Popup</a><iframe title="Child frame" src="/frame"></iframe><div id="space">Scroll content</div><script>console.log('fixture log'); console.error('fixture error'); fetch('/api/test'); fetch('/missing'); window.heapFixture={value:'heap marker'};</script></body></html>`,
    )
  })
  await once(web.listen(0, "127.0.0.1"), "listening")
  const address = web.address()
  assert(address && typeof address !== "string")
  const fixture = `http://127.0.0.1:${address.port}`
  const client = OpenCode.make({
    baseUrl: process.env.SMOKE_URL!,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${process.env.SMOKE_PASSWORD}`).toString("base64")}` },
  })
  const location = { directory: process.env.SMOKE_SERVER_FILES! }
  const rpc = client.rpc(Smoke)
  const session = await client.session.create({ title: "Browser suite", location })
  const pane = createBrowserPane()
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { sandbox: true } })
  const readyToShow = once(win, "ready-to-show")
  await win.loadURL("about:blank")
  await readyToShow
  win.setTitle("Browser suite (isolated test)")
  win.showInactive()
  await win.webContents.executeJavaScript(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))",
  )
  const ipcErrors: string[] = []
  const inventories = new Map<string, Browser.State | null>()
  const unbind = await Effect.runPromise(bindIpcEvents(win.webContents.id))
  const events = Effect.runFork(
    ipcEventStream(win.webContents.id).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event._tag !== "BrowserPaneEvent") return
          if (event.event.type === "state") {
            inventories.set(event.bindingID, event.event.state)
            return
          }
          if (!inventories.get(event.bindingID)?.tabs.some((tab) => tab.id === event.event.tabID))
            ipcErrors.push("Focus arrived before its tab inventory")
        }),
      ),
    ),
  )
  const visited = new Set<Browser.Method>()
  async function call<Name extends Browser.Method>(
    name: Name,
    input: Omit<Extract<Browser.Action, { type: Name }>, "type">,
  ): Promise<Output<Name>> {
    console.log(`BROWSER ${name}`)
    const result = await rpc.execute(
      { sessionID: session.id, code: `return await tools.browser.${name}(${JSON.stringify(input)})` },
      { location },
    )
    assert(!result.error, result.output)
    const operation = Browser.Operations.find((operation) => operation.name === name)
    assert(operation)
    visited.add(name)
    return Schema.decodeUnknownSync(operation.output)(JSON.parse(result.output)) as Output<Name>
  }
  try {
    await pane.register(win, "suite", {
      sessionID: session.id,
      endpoint: { url: process.env.SMOKE_URL!, password: process.env.SMOKE_PASSWORD },
    })
    const first = await call("tabs.open", { url: fixture })
    const second = await call("tabs.open", { url: `${fixture}/other`, focus: false })
    assert.equal((await call("tabs.list", {})).tabs.length, 2)
    const tabID = first.id
    await call("evaluate", {
      tabID,
      script: `(async () => {
      const source=document.createElement('div'); source.draggable=true; source.tabIndex=0; source.setAttribute('role','button'); source.textContent='Drag source'; source.ondragstart=e=>e.dataTransfer.setData('text/plain','element dropped'); document.body.prepend(source);
      const drop=document.createElement('div'); drop.tabIndex=0; drop.setAttribute('role','button'); drop.textContent='Drop target'; drop.style.cssText='height:40px;width:300px;background:#ddd'; drop.ondragover=e=>e.preventDefault(); drop.ondrop=async e=>{e.preventDefault();document.querySelector('output').textContent=e.dataTransfer.files.length?await e.dataTransfer.files[0].text():e.dataTransfer.getData('text/plain')}; document.body.prepend(drop);
      await new Promise(resolve=>{const frame=document.querySelector('iframe'); frame.onload=()=>resolve(null); frame.src=${JSON.stringify(`http://localhost:${address.port}/frame`)};});
    })()`,
    })
    pane.layout(win, "suite", { tabID, visible: true, bounds: { x: 0, y: 0, width: 1000, height: 700 } })
    await call("tabs.focus", { tabID: second.id })
    pane.layout(win, "suite", { tabID: second.id, visible: true, bounds: { x: 0, y: 0, width: 1000, height: 700 } })
    const snap = await call("snapshot", { tabID, boxes: true })
    const ref = (text: string) => {
      const match = snap.content
        .split("\n")
        .find((line) => /@e\d+/.test(line) && line.includes(`"${text}"`))
        ?.match(/@e\d+/)?.[0]
      assert(match, `Missing ${text}: ${snap.content}`)
      return Browser.Ref.make(match)
    }
    await call("fill", { tabID, ref: ref("Name"), text: "remote browser" })
    await call("hover", { tabID, ref: ref("Apply") })
    await call("click", { tabID, ref: ref("Apply") })
    assert.equal(
      (await call("evaluate", { tabID, script: "document.querySelector('output').textContent" })).value,
      "remote browser",
    )
    assert.equal(
      (await call("evaluate", { tabID: second.id, script: "document.querySelector('input').value" })).value,
      "",
    )
    assert.equal((await call("tabs.list", {})).focusedTabID, second.id)
    const wrongTab = await rpc.execute(
      {
        sessionID: session.id,
        code: `return await tools.browser.click({tabID:${JSON.stringify(second.id)},ref:${JSON.stringify(ref("Apply"))}})`,
      },
      { location },
    )
    assert(wrongTab.error && wrongTab.output.includes("another tab"))
    await call("check", { tabID, ref: ref("Remember"), checked: true })
    await call("select", { tabID, ref: ref("Color"), values: ["blue"] })
    await call("fill_form", {
      tabID,
      fields: [
        { type: "text", ref: ref("Name"), value: "batch" },
        { type: "check", ref: ref("Remember"), checked: false },
      ],
    })
    await call("press", { tabID, key: "Tab" })
    await call("scroll", { tabID, deltaY: 100 })
    await call("wait", { tabID, condition: "text", text: "Scroll content" })
    await call("drag", { tabID, from: ref("Drag source"), to: ref("Drop target") })
    assert.equal(
      (await call("evaluate", { tabID, script: "document.querySelector('output').textContent" })).value,
      "element dropped",
    )
    const frames = await call("frames", { tabID })
    const child = frames.frames.find((frame) => frame.parentID)
    assert(child)
    assert.equal(
      (await call("evaluate", { tabID, frameID: child.id, script: "document.querySelector('button').textContent" }))
        .value,
      "Frame button",
    )
    const childSnapshot = await call("snapshot", { tabID, frameID: child.id })
    const childRef = childSnapshot.content
      .split("\n")
      .find((line) => line.includes('[button] "Frame button"'))
      ?.match(/@e\d+/)?.[0]
    assert(childRef, childSnapshot.content)
    await call("click", { tabID, ref: Browser.Ref.make(childRef) })
    assert.equal(
      (await call("evaluate", { tabID, frameID: child.id, script: "document.querySelector('button').textContent" }))
        .value,
      "Frame clicked",
    )
    const found = await call("find", { tabID, text: "Apply" })
    assert(found.content.includes("Apply"))
    const screenshot = await call("screenshot", { tabID, fullPage: true, maxWidth: 1000 })
    const screenshotBytes = await rpc.read({ path: screenshot.files[0].path }, { location })
    assert(
      Buffer.from(screenshotBytes, "base64")
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    )
    assert(screenshot.files[0].path.startsWith(process.env.SMOKE_SERVER_FILES!))
    const logs = await call("console", { tabID, level: "debug" })
    assert(logs.messages.some((message) => message.text.includes("fixture error")))
    const network = await call("network.list", { tabID, urlContains: "/api/test" })
    assert(network.requests.length)
    const detail = await call("network.get", { tabID, id: network.requests[0].id, includeBody: true })
    assert.equal(detail.responseBody.state, "text")
    const upload = await rpc.write({ text: "server upload bytes" }, { location })
    const fileSnap = await call("snapshot", { tabID })
    const input = fileSnap.content
      .split("\n")
      .find((line) => line.includes('"Upload"'))
      ?.match(/@e\d+/)?.[0]
    assert(input, fileSnap.content)
    await call("files.upload", { tabID, ref: Browser.Ref.make(input), paths: [upload] })
    assert.equal(
      (await call("evaluate", { tabID, script: "document.querySelector('input[type=file]').files[0].name" })).value,
      "upload.txt",
    )
    assert.equal(
      (await call("evaluate", { tabID, script: "document.querySelector('input[type=file]').files[0].text()" })).value,
      "server upload bytes",
    )
    const drop = fileSnap.content
      .split("\n")
      .find((line) => line.includes('[button] "Drop target"'))
      ?.match(/@e\d+/)?.[0]
    assert(drop, fileSnap.content)
    await call("files.drop", { tabID, ref: Browser.Ref.make(drop), paths: [upload] })
    await call("wait", { tabID, condition: "text", text: "server upload bytes" })
    await call("evaluate", { tabID, script: "document.querySelector('a[href=\"/download\"]').click()" })
    const downloads = await until(async () => {
      const result = await call("files.list", { tabID })
      return result.files.find((file) => file.name === "report.txt" && file.state === "completed")
    })
    const download = await call("files.get", { tabID, fileID: downloads.id })
    assert.equal(
      Buffer.from(await rpc.read({ path: download.files[0].path }, { location }), "base64").toString(),
      "desktop download bytes",
    )
    await call("evaluate", { tabID, script: "setTimeout(()=>alert('hello dialog'),0); null" })
    await until(async () => (await call("dialog", { tabID, action: "get" })).dialog)
    await call("dialog", { tabID, action: "dismiss" })
    await call("evaluate", { tabID, script: "window.open('/frame'); null" })
    await until(async () => (await call("tabs.list", {})).tabs.length === 3)
    await call("navigate", { tabID, url: `${fixture}/next` })
    await call("back", { tabID })
    await call("forward", { tabID })
    await call("trace.start", { tabID, durationMs: 30_000 })
    await call("reload", { tabID })
    await call("evaluate", {
      tabID,
      script: "performance.mark('browser-suite-marker'); let n=0; for(let i=0;i<100000;i++) n+=i; n",
    })
    const trace = await call("trace.stop", { tabID })
    const traceAnalysis = await call("trace.analyze", { tabID, fileID: trace.files[0].id })
    assert(traceAnalysis.metrics[0].value > 0)
    await call("cpu.start", { tabID })
    await call("evaluate", { tabID, script: "Array.from({length:100000},(_,i)=>Math.sqrt(i)).reduce((a,b)=>a+b,0)" })
    const cpu = await call("cpu.stop", { tabID })
    await call("cpu.analyze", { tabID, fileID: cpu.files[0].id })
    const heap = await call("heap.snapshot", { tabID })
    const heapID = heap.files[0].id
    assert((await call("heap.summary", { tabID, fileID: heapID })).nodes > 0)
    const query = await call("heap.query", { tabID, fileID: heapID, name: "Object", limit: 3 })
    assert(query.nodes.length)
    await call("heap.object", { tabID, fileID: heapID, id: query.nodes[0].id })
    assert.equal((await call("heap.compare", { tabID, before: heapID, after: heapID })).classes.length, 0)
    const audit = await call("lighthouse", { tabID })
    assert(audit.scores.some((score) => score.id === "accessibility"))
    await call("stop", { tabID })
    await call("tabs.close", { tabID: second.id })
    assert.equal((await call("tabs.list", {})).tabs.length, 2)
    assert.deepEqual(
      Browser.Operations.map((operation) => operation.name).filter((name) => !visited.has(name)),
      [],
    )
    assert.deepEqual(ipcErrors, [])
    console.log(
      `PASS ${visited.size} browser operations over physical authenticated HTTP, including file bytes in both directions`,
    )
  } finally {
    await pane.close(win, "suite")
    await pane.dispose()
    await Effect.runPromise(Fiber.interrupt(events))
    await Effect.runPromise(unbind)
    win.destroy()
    web.closeAllConnections()
    await new Promise<void>((resolve) => web.close(() => resolve()))
    app.quit()
  }
}

async function until<T>(read: () => Promise<T>) {
  const deadline = Date.now() + 10_000
  while (true) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error("Condition timed out")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
