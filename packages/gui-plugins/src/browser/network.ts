import { net, session, type WebContents } from "electron"
import type { RpcClient } from "@opencode/client/effect/api"
import type { Session } from "@opencode/schema/session"
import { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserProxy } from "@opencode/plugin-browser/proxy"
import { Effect } from "effect"
import { Base64 } from "effect/encoding"

/** The connection a live page's proxy tunnels through. Absent while the server is disconnected. */
export type BrowserNetworkUpstream = {
  readonly rpc: RpcClient<typeof Browser.Definition, unknown>
  readonly attachment: { sessionID: Session.ID; connectionID: string }
  readonly location: { directory: string; workspace?: string }
}

export type BrowserNetwork = Effect.Success<ReturnType<typeof createBrowserNetwork>>

/** A session's proxy and partition, kept for as long as the session's live pages are. */
export const createBrowserNetwork = Effect.fn("BrowserNetwork.create")(function* (input: {
  readonly partition: string
  /** The current binding's tunnel RPC, or undefined while the server is disconnected. */
  readonly upstream: () => BrowserNetworkUpstream | undefined
}) {
  const current = () => {
    const upstream = input.upstream()

    if (!upstream) throw new Error("browser.network.disconnected")

    return upstream
  }

  const proxy = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      BrowserProxy.make({
        open: (target, signal) => {
          const upstream = current()

          return Effect.runPromise(
            upstream.rpc["tunnel.open"]({ ...upstream.attachment, target }, { location: upstream.location }),
            { signal },
          )
        },
        read: (tunnelID, signal) => {
          const upstream = current()

          return Effect.runPromise(
            upstream.rpc["tunnel.read"]({ ...upstream.attachment, tunnelID }, { location: upstream.location }),
            { signal },
          )
        },
        write: (tunnelID, data, end, signal) => {
          const upstream = current()

          return Effect.runPromise(
            upstream.rpc["tunnel.write"](
              { ...upstream.attachment, tunnelID, data: Base64.encode(data), end },
              { location: upstream.location },
            ),
            { signal },
          )
        },
        close: (tunnelID) => {
          const upstream = current()

          return Effect.runPromise(
            upstream.rpc["tunnel.close"]({ ...upstream.attachment, tunnelID }, { location: upstream.location }).pipe(
              Effect.timeout("5 seconds"),
            ),
          )
        },
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
    /** Ends the page connections that still run through the old binding; new requests fail fast. */
    disconnect: () => partition.closeAllConnections(),
    /**
     * Fetches a page icon through the server's network, as the page loaded it. Resolves undefined for anything but a
     * small image: a failure, a timeout, another content type, or more than `MAX_ICON_BYTES`.
     */
    icon: (url: string) =>
      new Promise<{ mime: string; data: Buffer } | undefined>((resolve) => {
        const request = net.request({ url, session: partition, useSessionCookies: true, redirect: "follow" })
        const chunks: Buffer[] = []

        const finish = (value?: { mime: string; data: Buffer }) => {
          clearTimeout(timeout)
          resolve(value)
        }

        const fail = () => {
          request.abort()
          finish()
        }

        const timeout = setTimeout(fail, 5_000)
        request.on("login", (auth, callback) => {
          if (auth.isProxy && auth.host === proxy.host && auth.port === proxy.port)
            return callback(proxy.credentials.username, proxy.credentials.password)
          callback()
        })
        request.on("response", (response) => {
          const header = response.headers["content-type"]
          const mime = (Array.isArray(header) ? header[0] : header)?.split(";")[0]?.trim().toLowerCase() ?? ""

          if (response.statusCode !== 200 || !mime.startsWith("image/")) return fail()
          response.on("data", (chunk) => {
            chunks.push(chunk)

            if (chunks.reduce((size, item) => size + item.length, 0) > MAX_ICON_BYTES) fail()
          })
          response.on("end", () => finish({ mime, data: Buffer.concat(chunks) }))
          response.on("error", fail)
        })
        request.on("error", fail)
        request.end()
      }),
  }
})

/** Icons larger than this are not worth reducing; sites list a favicon of a few kilobytes. */
const MAX_ICON_BYTES = 256 * 1024
