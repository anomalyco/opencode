import { stat, writeFile } from "node:fs/promises"
import path from "node:path"
import electron from "electron"
import { runBrowserMain } from "./electron-main"

// The Electron main process of `electron-import-choice.test.ts`, bundled and run by the pinned Electron with every
// location the browser list reads pointed at the test's made-up home. It runs the browser plugin's own main entry and
// imports through its Ipc, as the import dialog does, what each of the dialog's two boxes stands for: sign-ins only,
// both, both of one chosen site, and history only. It prints one JSON line.

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { BrowserProfile } = await import("./profile/ipc")
  const store = path.join(electron.app.getPath("userData"), "browser-history", "history.sqlite")
  const { profile, history, caller, session, cookies, outcome, close } = await runBrowserMain()
  const methods = BrowserProfile.spec.methods

  // Each answer as the Ipc's schema encodes it for the window, which fails on one the contract does not allow.
  const bring = (what: { readonly cookies?: boolean; readonly history?: boolean; readonly sites?: readonly string[] }) =>
    outcome(async () =>
      Schema.encodeSync(methods.importBrowser.output)(
        await profile.importBrowser({ source: "firefox", profile: "Profiles/work.default", ...what }, caller),
      ),
    )

  // The store's file exists once anything opened the store.
  const opened = () =>
    stat(store).then(
      () => true,
      () => false,
    )

  // Every page of the made-up history has a "t" in its address.
  const pages = async () => (await history.search({ query: "t", limit: 10 }, caller)).map((page) => page.url).toSorted()

  // The browser's cookies and the history go, so each import is counted for itself.
  const reset = async () => {
    await session.clearStorageData({ storages: ["cookies"] })
    await history.clear(undefined, caller)
  }

  const signins = { result: await bring({ history: false }), cookies: await cookies(), store: await opened() }
  await reset()
  const both = { result: await bring({ history: true }), cookies: await cookies(), pages: await pages() }
  await reset()
  const site = { result: await bring({ history: true, sites: ["bank.test"] }), cookies: await cookies(), pages: await pages() }
  await reset()
  // From here the other browser's cookie database is no database: any read of it fails.
  await writeFile(process.env.BROWSER_FIXTURE_COOKIES ?? "", Buffer.alloc(8192, "not a database. "))
  const historyOnly = { result: await bring({ cookies: false, history: true }), cookies: await cookies(), pages: await pages() }
  await reset()
  const historySite = { result: await bring({ cookies: false, history: true, sites: ["bank.test"] }), pages: await pages() }
  const read = await bring({ history: false })

  process.stdout.write(`${JSON.stringify({ signins, both, site, historyOnly, historySite, read })}\n`)
  await close()
  electron.app.quit()
})
