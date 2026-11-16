import { app, session, WebContentsView } from "electron"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { filterReady } from "./filter-startup"

// Run the real readiness probes in the pinned Electron. Both installs have working backgrounds but neither can
// block a request: a disabled static ruleset is a valid DNR configuration; a webRequest-only worker is unsupported.
void app.whenReady().then(async () => {
  const profile = session.fromPartition("persist:readiness")
  const signal = new AbortController().signal

  const install = async (name: string, manifest: { permissions: string[]; background?: { service_worker: string }; declarative_net_request?: { rule_resources: { id: string; enabled: boolean; path: string }[] } }) => {
    const folder = path.join(app.getPath("userData"), name)
    await mkdir(folder)
    await writeFile(path.join(folder, "manifest.json"), JSON.stringify({ name, version: "1", manifest_version: 3, ...manifest }))
    await writeFile(path.join(folder, "worker.js"), "")
    await writeFile(path.join(folder, "rules.json"), "[]")

    return profile.extensions.loadExtension(folder)
  }

  const worker = await install("Worker", { background: { service_worker: "worker.js" }, permissions: ["webRequest"] })
  const dnr = await install("Rules", { permissions: ["declarativeNetRequest"], declarative_net_request: { rule_resources: [{ id: "one", enabled: true, path: "rules.json" }] } })
  const page = new WebContentsView({ webPreferences: { session: profile, sandbox: true } }).webContents
  await page.loadURL(new URL("manifest.json", dnr.url).href)
  await page.executeJavaScript("chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['one']})")
  console.log(JSON.stringify({ worker: await filterReady(profile, worker, signal), emptyRules: await filterReady(profile, dnr, signal) }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
