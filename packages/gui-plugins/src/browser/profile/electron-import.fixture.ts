import path from "node:path"
import electron from "electron"
import { writeCookies } from "./import"
import { siteFilter } from "./sites"
import { readSource } from "./sources"

// The Electron main process of `electron-import.test.ts`, bundled and run by the pinned Electron with every location
// the browser list reads pointed at the test's made-up home. It imports the chosen sites of a made-up Firefox profile
// into an in-memory session, the way the profile's import does, then another site, and prints one JSON line.

void electron.app.whenReady().then(async () => {
  const session = electron.session.fromPartition("import-test")
  const scratch = { directory: path.join(process.env.HOME ?? "", "copies"), live: new Set<string>(), log: () => undefined }

  const cookies = async () =>
    (await session.cookies.get({})).map((cookie) => [cookie.domain, cookie.name, cookie.value, cookie.hostOnly]).toSorted()

  const chosen = async (sites: string[]) => {
    const read = await readSource("firefox", "Profiles/work.default", scratch, siteFilter(sites))

    return "failure" in read ? read : writeCookies(session, read, true)
  }

  const first = await chosen(["github.com"])
  const afterFirst = await cookies()
  const second = await chosen(["bank.test"])
  const afterSecond = await cookies()
  process.stdout.write(`${JSON.stringify({ first, afterFirst, second, afterSecond })}\n`)
  electron.app.quit()
})
