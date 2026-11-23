import { createServer } from "node:http"
import electron from "electron"
import { createCdp } from "./cdp"
import { removeFilePickers } from "./file-pickers"

// The Electron main process of `electron-file-pickers.test.ts`. A page and its same-origin frame, with the File System
// Access pickers removed; it prints, as one JSON line, which pickers each still has, and whether a file input still opens
// a chooser (seen through Chromium's file chooser intercept, so no dialog is shown).

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>pickers</title><input type=file><iframe srcdoc='<p>frame'></iframe>")
})

const pickers = (scope: string) =>
  `["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"].filter((name) => name in ${scope})`

void electron.app.whenReady().then(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const win = new electron.BrowserWindow({ show: false })
  const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: "file-pickers" } })
  win.contentView.addChildView(view)
  const contents = view.webContents
  await contents.loadURL("about:blank")
  const cdp = createCdp(contents)
  await cdp.send("Page.enable")
  const url = `http://127.0.0.1:${address instanceof Object ? address.port : 0}/`
  // A loopback page is a secure context, the only kind that has the pickers.
  await contents.loadURL(url)
  const before = await contents.executeJavaScript(pickers("globalThis"))
  await removeFilePickers(cdp)
  await contents.loadURL(url)

  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true })
  const chooser = new Promise<string>((resolve) => cdp.on("Page.fileChooserOpened", (event) => resolve(event.mode)))
  await contents.executeJavaScript(`document.querySelector("input").click()`, true)

  process.stdout.write(
    `${JSON.stringify({
      before,
      page: await contents.executeJavaScript(pickers("globalThis")),
      frame: await contents.executeJavaScript(pickers("frames[0]")),
      fileInput: await chooser,
    })}\n`,
  )
  server.close()
  electron.app.quit()
})
