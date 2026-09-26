import assert from "node:assert/strict"
import { app, BrowserWindow } from "electron"
import { ZOOM_FACTOR_KEY } from "../../src/main/storage/keys"
import { getStore } from "../../src/main/storage/store"
import { setPinchZoomEnabled, setZoomFactor, wireZoom } from "../../src/main/windows/appearance"
import { storedZoomFactor } from "../../src/main/windows/defaults"

void main().catch((error) => {
  console.error(error)
  app.exit(1)
})

async function main() {
  app.setPath("userData", process.env.ZOOM_TEST_ROOT!)
  await app.whenReady()
  const restored = process.env.ZOOM_TEST_RESTORE === "1"
  assert.equal(storedZoomFactor(), restored ? 1.4 : 1)
  const win = new BrowserWindow({ show: false, webPreferences: { zoomFactor: storedZoomFactor() } })
  wireZoom(win)
  await win.loadURL("data:text/html,<h1>Zoom persistence</h1>")
  assert.equal(win.webContents.getZoomFactor(), restored ? 1.4 : 1)

  if (!restored) {
    setZoomFactor(win, 1.2)
    assert.equal(getStore().get(ZOOM_FACTOR_KEY), 1.2)
    setPinchZoomEnabled(true)
    setPinchZoomEnabled(false)
    assert.equal(win.webContents.getZoomFactor(), 1.2)
    win.webContents.emit("zoom-changed", { preventDefault() {} }, "out")
    assert.equal(win.webContents.getZoomFactor(), 1.2)
    assert.equal(storedZoomFactor(), 1.2)
    setPinchZoomEnabled(true)
    win.webContents.emit("zoom-changed", { preventDefault() {} }, "in")
    assert.equal(win.webContents.getZoomFactor(), 1.4)
    assert.equal(storedZoomFactor(), 1.4)
  }

  if (restored) {
    const loaded = new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()))
    win.reload()
    await loaded
    assert.equal(win.webContents.getZoomFactor(), 1.4)
    setZoomFactor(win, 1)
    assert.equal(storedZoomFactor(), 1)
    setZoomFactor(win, 100)
    assert.equal(storedZoomFactor(), 10)
    setZoomFactor(win, 0.01)
    assert.equal(storedZoomFactor(), 0.2)
    for (const value of [null, "1.2", -1, 0, 11]) {
      getStore().set(ZOOM_FACTOR_KEY, value)
      assert.equal(storedZoomFactor(), 1)
    }
    getStore().delete(ZOOM_FACTOR_KEY)
    assert.equal(storedZoomFactor(), 1)
  }
  win.destroy()
  app.exit(0)
}
