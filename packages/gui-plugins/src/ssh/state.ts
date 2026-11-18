import { createRoot, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { createKeyed, type IpcClient } from "@opencode/plugin/gui"
import type { Ssh, SshConfig, SshHttp, SshItem } from "./contract"
import {
  createSshWindowState,
  selectSshActiveAttempt,
  selectSshAnsweredPrompt,
  selectSshCanOffer,
  selectSshCanOpenDialog,
  selectSshError,
  selectSshPending,
  selectSshPromptTarget,
  selectSshResolvable,
  selectSshSubmitting,
  transitionSshWindow,
  type SshWindowEffect,
  type SshWindowEvent,
} from "./window-machine"

export type SshController = ReturnType<typeof createSshController>

type SshApi = IpcClient<(typeof Ssh)["spec"]>

/** Runs this window's SSH attempts through the machine in `./window-machine`; main owns the connections. */
export function createSshController(input: {
  items: () => readonly SshItem[]
  /** Undefined while the main side is loading or gone. */
  api: Accessor<SshApi | undefined>
  /** Resolves once this window's state includes `revision`, the main side goes away, or `signal` aborts. */
  refresh: (revision: number, signal: AbortSignal) => Promise<void>
  error: () => void
  /** The routed path; each change starts a new visit, on which a cover offers authentication once per server. */
  path?: Accessor<string>
}) {
  const path = input.path ?? (() => "")
  // The machine state is immutable; each transition replaces it whole.
  const [machine, setMachine] = createSignal(createSshWindowState())
  // Aborts the wait for an admitted attempt's state, per server.
  const tasks = new Map<string, AbortController>()
  const lifetime = new AbortController()
  const item = (id: string) => input.items().find((item) => item.config.id === id)
  const current = (id: string) => untrack(() => item(id))

  const dispatch = (event: SshWindowEvent) => {
    const previous = untrack(machine)
    const next = transitionSshWindow(previous, event)

    if (next.state !== previous) setMachine(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SshWindowEffect) => {
    if (effect.type === "task.abort") {
      tasks.get(effect.id)?.abort()
      tasks.delete(effect.id)

      return
    }

    if (effect.type === "toast.error") return input.error()

    if (effect.type === "waiters.notify")
      return queueMicrotask(() => effect.waiters.forEach((waiter) => waiter(effect.ready)))
    const api = untrack(input.api)

    // Restores and cancels answer nobody; a main side that went away has nothing left to restore or cancel.
    if (effect.type === "rpc.restore") return void api?.start({ ...effect.config, background: true }).catch(() => {})

    if (effect.type === "rpc.cancel")
      return void api
        ?.cancel({ id: effect.id })
        .then(() => (effect.forget ? api.forget({ id: effect.id }) : undefined))
        .catch(() => {})

    if (effect.type === "rpc.respond") {
      const attempt = effect.attempt

      if (!api) return dispatch({ type: "respond.failed", id: effect.id, attempt })

      return void api.respond({ id: effect.id, prompt: effect.prompt, value: effect.value }).then(
        () => dispatch({ type: "respond.succeeded", id: effect.id, attempt, item: current(effect.id) }),
        () => dispatch({ type: "respond.failed", id: effect.id, attempt }),
      )
    }

    const id = effect.id
    const attempt = effect.attempt

    if (!api) return dispatch({ type: "start.failed", id, attempt })
    const abort = new AbortController()
    tasks.set(id, abort)

    void api
      .start({ ...effect.config, replace: effect.replace })
      // Observe admission before treating an older disconnected snapshot as the attempt's outcome.
      .then((revision) => input.refresh(revision, AbortSignal.any([abort.signal, lifetime.signal])))
      .then(
        () => dispatch({ type: "start.confirmed", id, attempt, item: current(id) }),
        () => dispatch({ type: "start.failed", id, attempt }),
      )
      .finally(() => {
        if (tasks.get(id) === abort) tasks.delete(id)
      })
  }

  /** Waits until a call to main can answer with the server's endpoint: never while main or the server is paused. */
  const resolvable = (id: string, seen: readonly SshItem[] | undefined, signal: AbortSignal) =>
    new Promise<SshApi>((done, fail) =>
      createRoot((dispose) => {
        const aborted = () => {
          dispose()
          fail(signal.reason)
        }

        if (signal.aborted) return aborted()
        signal.addEventListener("abort", aborted, { once: true })
        createKeyed(
          () => {
            const items = input.items()
            const api = input.api()

            // After a `null`, only a newer state can change the answer.
            if (items === seen || !api) return undefined

            return selectSshResolvable(
              true,
              items.find((item) => item.config.id === id),
            )
              ? api
              : undefined
          },
          (api) => {
            signal.removeEventListener("abort", aborted)
            dispose()
            done(api)
          },
        )
      }),
    )

  const resolve = (id: string, signal: AbortSignal, seen?: readonly SshItem[]): Promise<SshHttp> =>
    resolvable(id, seen, signal).then((api) => {
      const items = untrack(input.items)

      return api.resolve({ id }, { signal }).then((http) => http ?? resolve(id, signal, items))
    })

  onCleanup(() => {
    lifetime.abort()
    dispatch({ type: "disposed" })
  })

  // Follows main's state: attempts it shows an outcome for settle, and saved servers this window has not seen restore.
  createKeyed(
    () => ({ ipcActive: !!input.api(), items: input.items() }),
    (synced) => dispatch({ type: "items.synced", ipcActive: synced.ipcActive, items: synced.items }),
    { equals: (previous, next) => previous.ipcActive === next.ipcActive && previous.items === next.items },
  )

  // Follows the router: routing another page or tab starts a new visit.
  createKeyed(
    () => ({ path: path() }),
    (route) => dispatch({ type: "visit.changed", path: route.path }),
    { equals: (previous, next) => previous.path === next.path },
  )

  return {
    item,
    submitting: (id: string) => selectSshSubmitting(machine(), id),
    error: (id: string) => selectSshError(machine(), id),
    answeredPrompt: (id: string) => selectSshAnsweredPrompt(machine(), id),
    activeAttempt: (id: string) => selectSshActiveAttempt(machine(), id),
    pending: (id: string) => selectSshPending(machine(), id, item(id)),
    cover: {
      /** The server's cover may offer authentication on this visit. */
      canOffer: (id: string, dialogActive: boolean) =>
        selectSshCanOffer(machine(), id, path(), dialogActive, !!input.api(), item(id)),
      offer: (id: string, dialogActive: boolean) =>
        dispatch({
          type: "cover.offered",
          id,
          path: untrack(path),
          dialogActive,
          ipcActive: !!untrack(input.api),
          item: current(id),
        }),
    },
    dialog: {
      /** The attempt whose prompt needs a dialog of its own. */
      next: () => selectSshPromptTarget(machine(), input.items()),
      loading: (id: string, attempt: number) => dispatch({ type: "dialog.loading", id, attempt }),
      canOpen: (id: string, attempt: number) => selectSshCanOpenDialog(untrack(machine), id, attempt),
      opened: (id: string, attempt: number) => dispatch({ type: "dialog.opened", id, attempt }),
      failed: (id: string, attempt: number) =>
        dispatch({ type: "dialog.failed", id, attempt, saved: !!current(id)?.saved }),
    },
    /** `onConnected` runs once the attempt settles, with whether the server is ready. */
    connect: (
      config: SshConfig,
      options?: { dialog?: boolean; replace?: boolean; onConnected?: (ready: boolean) => void },
    ) =>
      dispatch({
        type: "connect.requested",
        config,
        ipcActive: !!untrack(input.api),
        item: current(config.id),
        dialog: options?.dialog,
        replace: options?.replace,
        onConnected: options?.onConnected,
      }),
    respond: (id: string, prompt: string, value: string) =>
      dispatch({ type: "respond.requested", id, prompt, value, ipcActive: !!untrack(input.api), item: current(id) }),
    cancel: (id: string) => dispatch({ type: "cancel.requested", id, saved: !!current(id)?.saved }),
    /** Waits for a healthy tunnel; main reconnects a dropped one by itself. */
    resolve: (id: string, signal: AbortSignal) => resolve(id, AbortSignal.any([signal, lifetime.signal])),
  }
}
