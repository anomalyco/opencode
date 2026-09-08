import { app, BrowserWindow } from "electron"
import { DesktopStorage } from "../../src/main/storage"
import { registerRendererProtocol } from "../../src/main/windows/protocol"
import { NodePath } from "@effect/platform-node"
import { Effect } from "effect"
import { createServer } from "node:http"
import { once } from "node:events"
import { createExtensionManager } from "../../src/main/extensions/manager"
import { loadMainPlugin } from "../../src/main/extensions/module"
import { createMainExtensionHost } from "../../src/main/extensions/host"
import { extensionArchive } from "./fixture"
import assert from "node:assert/strict"

async function mainTest() {
  app.setPath("userData", process.env.EXTENSION_TEST_HOME!)
  await app.whenReady()
  const web = createServer((_request, response) => {
    response.setHeader("content-type", "text/html")
    response.end("<title>Fixture</title>")
  })
  web.listen(0, "127.0.0.1")
  await once(web, "listening")
  const address = web.address()
  if (!address || typeof address === "string") throw new Error("Fixture address is unavailable")
  process.env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${address.port}`
  const database = DesktopStorage.make(":memory:")
  await Effect.runPromise(
    registerRendererProtocol().pipe(
      Effect.provideService(DesktopStorage.Service, database),
      Effect.provide(NodePath.layer),
    ),
  )
  const win = new BrowserWindow({ show: false })
  await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  const manager = createExtensionManager({ db: database.db, fetch, changed: (id) => host.releaseAll(id) })
  const host = createMainExtensionHost(
    [],
    () => {},
    (id) => loadMainPlugin(manager, id),
  )
  const main = (version: string) => `
  const { MainPlugin } = require('@opencode/plugin/desktop/main');
  const { Rpc } = require('@opencode/schema/rpc');
  const { Schema } = require('effect');
  module.exports.default = MainPlugin.define({ id: 'test.lifecycle', rpc: Rpc.define({ id: 'test.lifecycle', methods: { ping: { input: Schema.String, output: Schema.String } }, events: {} }), setup(ctx) {
    ctx.window.setTitle(${JSON.stringify(version)});
    ctx.lifecycle.own(() => ctx.window.setTitle('disposed'));
    return { ping: (value) => ${JSON.stringify(version)} + ':' + value };
  } });`
  const call = () =>
    host.call(win, {
      extensionID: "test.lifecycle",
      rpcID: "test.lifecycle",
      method: "ping",
      requestID: crypto.randomUUID(),
      input: "hello",
    })
  try {
    const [installed] = await manager.install(
      await extensionArchive({ main: main("one"), files: { "assets/value.txt": "native asset" } }),
    )
    const asset = `oc://extensions/${installed.id}/${installed.revision}/assets/value.txt`
    assert.equal(
      await win.webContents.executeJavaScript(`fetch(${JSON.stringify(asset)}).then(response => response.text())`),
      "native asset",
    )
    assert.deepEqual(await call(), { ok: true, output: "one:hello" })
    assert.equal(win.getTitle(), "one")
    manager.reload("test.lifecycle")
    assert.equal(win.getTitle(), "disposed")
    assert.deepEqual(await call(), { ok: true, output: "one:hello" })
    manager.enable("test.lifecycle", false)
    assert.equal(win.getTitle(), "disposed")
    assert.equal(((await call()) as { ok: boolean }).ok, false)
    await manager.install(await extensionArchive({ version: "2.0.0", main: main("two") }))
    assert.deepEqual(await call(), { ok: true, output: "two:hello" })
    assert.equal(win.getTitle(), "two")
    await host.dispose()
    assert.equal(win.getTitle(), "disposed")
    win.destroy()
    database.close()
    web.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
void mainTest().catch((error) => {
  console.error(error)
  app.exit(1)
})
