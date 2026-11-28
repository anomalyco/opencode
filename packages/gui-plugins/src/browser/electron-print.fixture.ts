import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import type { TabActivity } from "./policy"
import { guardPrint } from "./print-gate"

// The Electron main process of `electron-print.test.ts`. Three tabs with the print gate: one the agent opened, one a
// person's, and a person's the agent then takes over. It prints, as one JSON line, whether each page's print() is still
// the browser's own. It never calls a native print(), which would open the system dialog.

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>print</title><iframe srcdoc='<p>frame'></iframe>")
})

const native = `[print.toString().includes("[native code]"), frames[0].print.toString().includes("[native code]")]`

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${address instanceof Object ? address.port : 0}/`
  const win = new electron.BrowserWindow({ show: false })

  const tab = async (activity: TabActivity) => {
    const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "print-gate" } })
    win.contentView.addChildView(view)
    await view.webContents.loadURL("about:blank")
    const cdp = createCdp(view.webContents)
    const prints = guardPrint(cdp, activity)
    await cdp.send("Page.enable")
    await prints.attach()
    await view.webContents.loadURL(url)

    return { contents: view.webContents, prints }
  }

  const agent = await tab({ agentRuns: 0, control: "agent" })
  // The gate's print() returns at once; the browser's would wait here for the system dialog.
  const agentReturned = await agent.contents.executeJavaScript(`print(); "returned"`)

  const personActivity: TabActivity = { agentRuns: 0 }
  const person = await tab(personActivity)
  const personBefore = await person.contents.executeJavaScript(native)
  personActivity.control = "agent"
  await person.prints.update()
  const takenOver = await person.contents.executeJavaScript(native)

  process.stdout.write(
    `${JSON.stringify({ agent: await agent.contents.executeJavaScript(native), agentReturned, personBefore, takenOver })}\n`,
  )
  server.close()
  electron.app.quit()
})
