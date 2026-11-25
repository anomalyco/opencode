import electron from "electron"
import type { Caller, Ipc, IpcImpl, IpcSpec, MainContext } from "@opencode/plugin/gui/main"

/**
 * The browser plugin's own main entry, run in the Electron of a real-Electron fixture, and the two Ipcs it provides as
 * a window calls them. No pane is registered, so no window, server or page is asked for. `close` ends the plugin.
 */
export async function runBrowserMain() {
  const { default: setup } = await import("./main")
  const { BrowserHistory } = await import("./history/ipc")
  const { BrowserProfile } = await import("./profile/ipc")
  const values = new Map<string, unknown>()
  const provided = new Map<string, IpcImpl<IpcSpec>>()
  const cleanups: (() => void | Promise<void>)[] = []
  const logged: string[] = []
  const lifetime = new AbortController()

  // SAFETY: the main entry and the profile read of the context only what is here: storage as a map of values, the
  // log, the Ipcs they provide and their cleanup.
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
  const caller: Caller = { window: 1, signal: lifetime.signal }
  const session = electron.session.fromPartition("persist:opencode-browser")

  return {
    profile: ipc(BrowserProfile),
    history: ipc(BrowserHistory),
    caller,
    /** The browser's own cookie store, which an import writes. */
    session,
    /** How many cookies the browser has. */
    cookies: async () => (await session.cookies.get({})).length,
    /** What the desktop log received. */
    logged,
    /** What a window's call comes to: the answer, or the rejection. */
    outcome: <A>(call: () => A | Promise<A>) =>
      Promise.resolve()
        .then(call)
        .then(
          (value) => ({ value }),
          () => ({ rejected: true }),
        ),
    async close() {
      lifetime.abort()
      await Promise.all(cleanups.map((cleanup) => cleanup()))
    },
  }
}
