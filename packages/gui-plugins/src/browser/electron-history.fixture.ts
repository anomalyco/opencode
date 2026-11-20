import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import electron from "electron"
import type { Caller, Ipc, IpcImpl, IpcSpec, MainContext } from "@opencode/plugin/gui/main"

// The Electron main process of `electron-history.test.ts`, bundled and run by the pinned Electron with every location
// the browser list reads pointed at the test's made-up home. It runs the browser plugin's own main entry and calls the
// two Ipcs it provides, as a window does, while the history store's file is something that cannot be opened: first a
// directory, which cannot be deleted either, then a file that is not a database. It prints one JSON line.

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { default: setup } = await import("./main")
  const { BrowserHistory } = await import("./history/ipc")
  const { BrowserProfile } = await import("./profile/ipc")
  const file = path.join(electron.app.getPath("userData"), "browser-history", "history.sqlite")
  const values = new Map<string, unknown>()
  const provided = new Map<string, object>()
  const cleanups: (() => void | Promise<void>)[] = []
  const logged: string[] = []
  const lifetime = new AbortController()

  // SAFETY: the main entry and the profile read of the context only what is here: storage as a map of values, the
  // log, the Ipcs they provide and their cleanup. No pane is registered, so no window, server or page is asked for.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const ctx = {
    id: "browser",
    signal: lifetime.signal,
    t: (key: string) => key,
    app: { name: "opencode", version: "0.0.0", channel: "local", platform: "desktop", packaged: false },
    log: { write: (_level: string, message: string) => void logged.push(message) },
    storage: {
      store: (key: string, options: { initial: unknown }) => ({
        get value() {
          return values.has(key) ? values.get(key) : options.initial
        },
        ready: () => true,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
        set: (next: unknown) => void values.set(key, next),
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
        update(mutate: (draft: unknown) => void) {
          const draft = structuredClone(values.has(key) ? values.get(key) : options.initial)
          mutate(draft)
          values.set(key, draft)
        },
      }),
      remove: (key: string) => void values.delete(key),
    },
    windows: { get: () => undefined, list: () => [], focused: () => undefined, on: () => () => undefined },
    serverEndpoints: { get: () => undefined },
    provide: (token: { readonly id: string }, impl: IpcImpl<IpcSpec>) => {
      provided.set(token.id, impl)

      return { changed: () => undefined, emit: () => undefined }
    },
    add: () => () => undefined,
    onCleanup: (cleanup: () => void | Promise<void>) => void cleanups.push(cleanup),
  } as unknown as MainContext

  await setup(ctx)

  // SAFETY: `provide` above received each Ipc's own implementation from the main entry, whose type the token carries.
  const ipc = <S extends IpcSpec>(token: Ipc<S>) => provided.get(token.id) as IpcImpl<S>
  const profile = ipc(BrowserProfile)
  const history = ipc(BrowserHistory)
  const caller: Caller = { window: 1, signal: lifetime.signal }
  const session = electron.session.fromPartition("persist:opencode-browser")
  const cookies = async () => (await session.cookies.get({})).length

  // What a window's call comes to: the answer, or the rejection.
  const outcome = <A>(call: () => A | Promise<A>) =>
    Promise.resolve()
      .then(call)
      .then(
        (value) => ({ value }),
        () => ({ rejected: true }),
      )

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
  lifetime.abort()
  await Promise.all(cleanups.map((cleanup) => cleanup()))
  electron.app.quit()
})
