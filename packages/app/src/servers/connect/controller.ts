import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { replaceServerConnection } from "@/servers/registry/management"
import {
  createServerConnectState,
  selectServerConnectView,
  transitionServerConnect,
  type ServerConnectEffect,
  type ServerConnectEvent,
  type ServerConnectTarget,
  type ServerOriginal,
} from "./machine"
import { useRedeemPairing } from "./redeem"

export type ServerConnectControllerOptions =
  | { readonly surface: "screen"; readonly target: Extract<ServerConnectTarget, { kind: "connect" }> }
  | {
      readonly surface: "dialog"
      readonly target: Exclude<ServerConnectTarget, { kind: "connect" }>
      /** The edited server as the registry lists it now; undefined once it is removed. */
      readonly original?: Accessor<ServerOriginal | undefined>
      readonly removeTabs: (key: ServerConnection.Key) => void
      /** Closes the dialog. `saved` is the server a successful save stored. */
      readonly onClose: (saved: ServerConnection.Http | undefined) => void
    }

export function createServerConnectController(options: ServerConnectControllerOptions) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  // Shared with the scanner, so a retry after a failed check reuses the token of a spent one-time code.
  const redeem = useRedeemPairing()
  const [machine, setMachine] = createSignal(createServerConnectState(options.target))
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ServerConnectEvent) => {
    const prev = untrack(machine)
    const next = transitionServerConnect(prev, event)

    if (next.state !== prev) setMachine(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: ServerConnectEffect) => {
    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "submit.timed-out", attempt: effect.attempt }), effect.timeoutMs)

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "connect.http") {
      const failed = () =>
        dispatch({
          type: "submit.failed",
          attempt: effect.attempt,
          error: { type: "connection-failed", url: effect.http.url },
        })

      void Promise.try(() => check(effect.http)).then(
        (result) =>
          result.type === "healthy"
            ? dispatch({ type: "submit.succeeded", attempt: effect.attempt, http: effect.http })
            : failed(),
        failed,
      )

      return
    }

    if (effect.type === "connect.link") {
      void Promise.try(() => pair(effect)).then(dispatch, () =>
        dispatch({
          type: "submit.failed",
          attempt: effect.attempt,
          error: { type: "connection-failed", url: effect.fallbackUrl },
        }),
      )

      return
    }

    if (effect.type === "save") {
      const action = effect.action

      if (action.type === "connect") {
        // Signing in again keeps the name the user gave this server.
        const existing = servers.list.find(
          (server): server is ServerConnection.Http => server.type === "http" && server.http.url === action.http.url,
        )

        servers.add(existing ? { ...existing, http: action.http } : { type: "http", http: action.http })

        return
      }

      if (action.type === "add" || options.surface !== "dialog") return void servers.add(action.connection)
      replaceServerConnection(ServerConnection.Key.make(action.originalUrl), action.connection, {
        removeTabs: options.removeTabs,
        add: (server) => servers.add(server),
        remove: (key) => servers.remove(key),
      })

      return
    }

    if (options.surface === "dialog") options.onClose(effect.saved)
  }

  const pair = async (effect: Extract<ServerConnectEffect, { type: "connect.link" }>): Promise<ServerConnectEvent> => {
    const redeemed = await redeem(effect.link)

    if (!redeemed) return { type: "submit.failed", attempt: effect.attempt, error: { type: "link-invalid" } }

    if ("error" in redeemed)
      return { type: "submit.failed", attempt: effect.attempt, error: { type: "redeem", message: redeemed.error } }
    const password = redeemed.pairing.password

    if (effect.preferredUrl && effect.preferredUrl !== redeemed.pairing.url) {
      const http = { url: effect.preferredUrl, password }

      if ((await check(http)).type === "healthy") return { type: "submit.succeeded", attempt: effect.attempt, http }
    }

    const http = { url: redeemed.pairing.url, password }

    if ((await check(http)).type === "healthy") return { type: "submit.succeeded", attempt: effect.attempt, http }

    return { type: "submit.failed", attempt: effect.attempt, error: { type: "connection-failed", url: http.url } }
  }

  // Runs once the dialog is in the stack, so a server removed before then closes this dialog, not the one below.
  if (options.surface === "dialog" && options.original)
    createEffect(on(options.original, (original) => dispatch({ type: "original.synced", original })))

  onCleanup(() => dispatch({ type: "disposed" }))

  const view = createMemo(() =>
    selectServerConnectView(machine(), {
      surface: options.surface,
      pageHref: platform.platform === "web" ? location.href : undefined,
      t: (key) => language.t(key),
    }),
  )

  return { view, dispatch, redeem }
}
