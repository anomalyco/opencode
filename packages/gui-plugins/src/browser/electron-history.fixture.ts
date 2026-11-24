import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import electron from "electron"
import { runBrowserMain } from "./electron-main"

// The Electron main process of `electron-history.test.ts`, bundled and run by the pinned Electron with every location
// the browser list reads pointed at the test's made-up home. It runs the browser plugin's own main entry and calls the
// two Ipcs it provides, as a window does, while the history store's file is something that cannot be opened: first a
// directory, which cannot be deleted either, then a file that is not a database. It prints one JSON line.

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { BrowserProfile } = await import("./profile/ipc")
  const file = path.join(electron.app.getPath("userData"), "browser-history", "history.sqlite")
  const { profile, history, caller, cookies, outcome, logged, close } = await runBrowserMain()

  // Each answer as its Ipc's schema encodes it for the window, which fails on one the contract does not allow.
  const methods = BrowserProfile.spec.methods

  const importAll = () =>
    outcome(async () =>
      Schema.encodeSync(methods.importBrowser.output)(
        await profile.importBrowser({ source: "firefox", profile: "Profiles/work.default", history: true }, caller),
      ),
    )

  const signOut = () => outcome(async () => Schema.encodeSync(methods.clear.output)(await profile.clear(undefined, caller)))
  const search = () => outcome(async () => (await history.search({ query: "rune", limit: 5 }, caller)).map((page) => page.url))

  // A directory where the store's file belongs: it cannot be opened, and deleting the file does not remove it.
  await mkdir(path.join(file, "kept"), { recursive: true })

  const blocked = {
    imported: await importAll(),
    cookies: await cookies(),
    search: await search(),
    signOut: await signOut(),
    cookiesAfter: await cookies(),
    clearHistory: await outcome(() => history.clear(undefined, caller)),
    kept: await readdir(file),
  }

  // A file that is not a database: it cannot be opened, and nothing in it can be kept.
  await rm(file, { recursive: true })
  await writeFile(file, Buffer.alloc(8192, "zebra-marker is not a database. "))

  const damaged = {
    imported: await importAll(),
    cookies: await cookies(),
    signOut: await signOut(),
    cookiesAfter: await cookies(),
    left: (await readFile(file).catch(() => Buffer.alloc(0))).includes("zebra-marker"),
  }

  // The store that replaced it works as any other.
  const replaced = { imported: await importAll(), search: await search(), signOut: await signOut(), searchAfter: await search() }

  process.stdout.write(`${JSON.stringify({ blocked, damaged, replaced, logged: logged.filter((message) => message.includes("history")) })}\n`)
  await close()
  electron.app.quit()
})
