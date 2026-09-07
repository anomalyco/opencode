import { session, type WebContents } from "electron"
import type { RpcClient } from "@opencode-ai/client/effect/api"
import type { Session } from "@opencode-ai/schema/session"
import { Browser } from "@opencode-ai/plugin-browser/rpc"
import { BrowserProxy } from "@opencode-ai/plugin-browser/proxy"
import { Effect, Encoding } from "effect"

export type BrowserNetwork = Effect.Success<ReturnType<typeof createBrowserNetwork>>

export const createBrowserNetwork = Effect.fn("BrowserNetwork.create")(function* (input: {
  rpc: RpcClient<typeof Browser.Definition, unknown>
  attachment: { sessionID: Session.ID; connectionID: string }
  location: { directory: string; workspace?: string }
  partition: string
}) {
  const options = { location: input.location }
  const proxy = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      BrowserProxy.make({
        open: (target, signal) =>
          Effect.runPromise(input.rpc["tunnel.open"]({ ...input.attachment, target }, options), { signal }),
        read: (tunnelID, signal) =>
          Effect.runPromise(input.rpc["tunnel.read"]({ ...input.attachment, tunnelID }, options), { signal }),
        write: (tunnelID, data, end, signal) =>
          Effect.runPromise(
            input.rpc["tunnel.write"](
              { ...input.attachment, tunnelID, data: Encoding.encodeBase64(data), end },
              options,
            ),
            { signal },
          ),
        close: (tunnelID) =>
          Effect.runPromise(
            input.rpc["tunnel.close"]({ ...input.attachment, tunnelID }, options).pipe(Effect.timeout("5 seconds")),
          ),
      }),
    ),
    (proxy) => Effect.promise(() => proxy.close()),
  )
  const partition = session.fromPartition(input.partition)
  yield* Effect.addFinalizer(() => Effect.promise(() => partition.closeAllConnections()))
  // This is the browser's private partition, not the app/API connection. Never
  // bypass localhost: it must resolve on the machine running the OC2 server.
  yield* Effect.tryPromise(() =>
    partition.setProxy({ mode: "fixed_servers", proxyRules: proxy.url, proxyBypassRules: "<-loopback>" }),
  )
  yield* Effect.tryPromise(() => partition.closeAllConnections())
  return {
    attach(contents: WebContents) {
      const login = (
        event: Electron.Event,
        _details: Electron.AuthenticationResponseDetails,
        auth: Electron.AuthInfo,
        callback: (username?: string, password?: string) => void,
      ) => {
        if (
          !auth.isProxy ||
          auth.scheme !== "basic" ||
          auth.host !== proxy.host ||
          auth.port !== proxy.port ||
          auth.realm !== "OpenCode Browser Proxy"
        )
          return
        event.preventDefault()
        callback(proxy.credentials.username, proxy.credentials.password)
      }
      contents.on("login", login)
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
      return () => contents.off("login", login)
    },
  }
})
