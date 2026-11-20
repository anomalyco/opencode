import { app, session, type Extension, type WebContents, WebContentsView } from "electron"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createFilterGate, filterReady } from "./filter-startup"

// Run the real worker, DNR and MV2 background probes in the pinned Electron.
void app.whenReady().then(async () => {
  const profile = session.fromPartition("persist:readiness")
  const signal = new AbortController().signal

  const install = async (name: string, manifest: { manifest_version?: number; permissions: string[]; background?: { service_worker: string } | { scripts: string[] }; declarative_net_request?: { rule_resources: { id: string; enabled: boolean; path: string }[] } }) => {
    const folder = path.join(app.getPath("userData"), name)
    await mkdir(folder)
    await writeFile(path.join(folder, "manifest.json"), JSON.stringify({ name, version: "1", manifest_version: 3, ...manifest }))
    await writeFile(path.join(folder, "worker.js"), manifest.manifest_version === 2
      ? "chrome.webRequest.onBeforeRequest.addListener(() => {}, {urls:['http://example.test/*']})"
      : "")
    await writeFile(path.join(folder, "rules.json"), "[]")

    // loadExtension can resolve before Chromium is ready to serve the extension's URLs.
    const ready = Promise.withResolvers<void>()

    const onReady = (_: Electron.Event, extension: Extension) => {
      if (extension.name === name) ready.resolve()
    }

    profile.extensions.on("extension-ready", onReady)

    try {
      const extension = await profile.extensions.loadExtension(folder)
      await ready.promise

      return extension
    } finally {
      profile.extensions.off("extension-ready", onReady)
    }
  }

  const worker = await install("Worker", { background: { service_worker: "worker.js" }, permissions: ["webRequest"] })
  const dnr = await install("Rules", { permissions: ["declarativeNetRequest"], declarative_net_request: { rule_resources: [{ id: "one", enabled: true, path: "rules.json" }] } })
  const page = new WebContentsView({ webPreferences: { session: profile, sandbox: true } }).webContents
  await page.loadURL(new URL("manifest.json", dnr.url).href)
  await page.executeJavaScript("chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['one']})")
  const reported: string[] = []
  const fallback = { reported: new Set<string>(), log: (id: string) => reported.push(id) }
  const result = { worker: await filterReady(profile, worker, signal, fallback), emptyRules: await filterReady(profile, dnr, signal, fallback) }

  const loaded = Promise.withResolvers<WebContents>()
  app.on("web-contents-created", (_, contents) => {
    if (contents.session === profile && contents.getType() === "backgroundPage") contents.once("did-finish-load", () => loaded.resolve(contents))
  })
  const requests = await install("Unrelated name", { manifest_version: 2, background: { scripts: ["worker.js"] }, permissions: ["webRequest", "http://example.test/*"] })
  const background = await loaded.promise
  const set = (code: string) => background.executeJavaScript(code)
  const unconfirmed: string[] = []
  const gate = createFilterGate(signal, id => unconfirmed.push(id))

  const start = () => {
    const first = Promise.withResolvers<boolean>()
    gate.start(requests.id, async life => {
      const ready = await filterReady(profile, requests, life, fallback)
      first.resolve(ready)

      return ready
    })

    return { first: first.promise, opening: gate.wait("http://example.test/", signal) }
  }

  // Drive the production gate's timers in main; the probe still reads a real, loaded extension background.
  const { mock } = await import("node:test")
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 })

  for (const setup of ["void 0", "globalThis.µBlock={readyToFilter:false}; globalThis.vAPI={net:{}}", "vAPI.net.suspendableListener=17"]) {
    await set(setup)
    const attempt = start()
    assert.equal(await attempt.first, true)
    await attempt.opening
    assert.equal(Date.now(), 0)
  }

  assert.deepEqual(reported, [requests.id])
  // Reloading the plugin creates fresh reporting state, even when Electron reuses the partition's session.
  await filterReady(profile, requests, signal, { ...fallback, reported: new Set() })
  assert.deepEqual(reported, [requests.id, requests.id])

  await set("vAPI.net.suspendableListener=undefined")
  const warming = start()
  assert.equal(await warming.first, false)
  await set("µBlock.readyToFilter=true")
  assert.equal(await filterReady(profile, requests, signal, fallback), false)
  await set("vAPI.net.suspendableListener=()=>{}; void 0")
  mock.timers.tick(50)
  await warming.opening
  assert.deepEqual(unconfirmed, [])

  await set("µBlock.readyToFilter=false")
  const stuck = start()
  assert.equal(await stuck.first, false)
  mock.timers.tick(4999)
  assert.deepEqual(unconfirmed, [])
  mock.timers.tick(1)
  await stuck.opening
  assert.deepEqual(unconfirmed, [requests.id])
  assert.ok(profile.extensions.getExtension(requests.id))
  mock.timers.reset()
  console.log(JSON.stringify(result))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
