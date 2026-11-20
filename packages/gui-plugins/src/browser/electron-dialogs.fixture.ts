import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { guardFileChoosers } from "./file-choosers"
import { recordPageInput, type TabActivity } from "./policy"
import { RESTORE_PROMPT, takeDialogs } from "./page-prompts"

// The Electron main process of `electron-dialogs.test.ts`, bundled and run by the pinned Electron. It opens a sandboxed
// page as the pane does, takes its dialogs, answers each through CDP, and prints what happened as one JSON line.

const page = `<!doctype html><title>dialogs</title><iframe srcdoc="<p>child</p>"></iframe>`

const server = createServer((_request, response) => {
  // The pane's strictest case: the page may load nothing, frames included, and run no script of its own.
  response.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'none'; frame-src 'none'" })
  response.end(page)
})

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false })
  const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } })
  win.contentView.addChildView(view)
  const contents = view.webContents
  // SAFETY: Electron's own internal events on a WebContents, read here only to count them.
  const events: NodeJS.EventEmitter = contents
  const before = events.listenerCount("-run-dialog")
  const warnings: string[] = []
  const opened: { type: string; message: string; origin?: string }[] = []
  let open = false

  const dialogs = takeDialogs(contents, {
    suppressed: () => false,
    opened: () => open,
    framed: () => {},
    warn: (message) => warnings.push(message),
  })

  // CDP's Page domain answers only once the page has a renderer.
  await contents.loadURL("about:blank")
  contents.debugger.attach("1.3")
  contents.debugger.on("message", (_event, method, params) => {
    if (method === "Page.javascriptDialogClosed") {
      open = false
      dialogs.closed()
    }

    if (method !== "Page.javascriptDialogOpening") return
    open = true
    // Answer once Electron reported the dialog too, as the user reads it in the pane.
    setTimeout(() => {
      opened.push({ type: params.type, message: params.message, origin: dialogs.frame()?.origin })
      void contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: true, promptText: "typed" })
    }, 100)
  })
  await contents.debugger.sendCommand("Page.enable")
  await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: RESTORE_PROMPT, runImmediately: true })
  await contents.loadURL(`${origin}/`)

  const answers = await contents.executeJavaScript(`[alert("a"), confirm("c"), prompt("p", "d")]`)
  const cdp = createCdp(contents)
  const backup = await cdp.send("Target.attachToTarget", { targetId: contents.getOrCreateDevToolsTargetId(), flatten: true })
  // Independent inspector: the user controls, and even a broken product guard, must NEVER show system UI in CI.
  await cdp.send("Page.enable", {}, backup.sessionId)
  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true, cancel: true }, backup.sessionId)
  const intercepts = { backup: 0, product: 0 }
  contents.debugger.on("message", (_event, method, _params, sessionID) => {
    if (method === "Page.fileChooserOpened") intercepts[sessionID === backup.sessionId ? "backup" : "product"]++
  })
  const activity: TabActivity = { agentRuns: 0 }
  const refusals: string[] = []
  const guard = guardFileChoosers(cdp, activity, message => refusals.push(message))
  await guard.attach()

  const choose = async (expression: string) => {
    const before = refusals.length
    await cdp.send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true })
    // Flush Page events even if the DOM call itself was synchronous.
    await cdp.send("Page.getFrameTree")

    return refusals.length - before
  }

  const file = `Object.assign(document.createElement('input'), {type:'file'}).click()`
  const user = await choose(file)
  activity.agentRuns++
  await guard.update()
  const picks = []

  for (const expression of [file, ...["OpenFile", "SaveFile", "Directory"].map(type => `show${type}Picker().catch(e => e.name)`)])
    picks.push(await choose(expression))

  activity.agentRuns--
  recordPageInput(activity, "agent")
  await guard.update()
  const delayed = await choose(file)
  recordPageInput(activity, "user")
  await guard.update()
  const returned = await choose(file)
  guard.dispose()
  cdp.dispose()
  // A dialog nobody answers through CDP still lets the page go: the takeover dismisses it.
  contents.debugger.detach()
  const unanswered = await contents.executeJavaScript(`confirm("nobody")`)
  process.stdout.write(`${JSON.stringify({ before, after: events.listenerCount("-run-dialog"), warnings, opened, answers, unanswered, origin, choosers: { user, picks, delayed, returned, intercepts } })}\n`)
  dialogs.dispose()
  server.close()
  electron.app.quit()
}).catch(error => {
  console.error(error)
  electron.app.exit(1)
})
