/**
 * /preview/<port>/<rest> — HTTP + WebSocket reverse proxy.
 *
 * Lets a collab participant's browser see a dev server running INSIDE the
 * opencode container.  When the LLM (or a user via the iframe's terminal)
 * does `npm run dev` and Vite binds to 127.0.0.1:5173, others can open
 *   https://collab.unleashlive.com/preview/5173/
 * and the request gets proxied through.
 *
 * Two pieces:
 *  - {@link handlePreviewHttp} for plain HTTP requests (web-standard
 *    Request/Response) — used from the collab middleware in server.ts
 *    after it identifies the path as /preview/.
 *  - {@link attachPreviewUpgrade} for WebSocket upgrades — wired into the
 *    Node http.Server's `upgrade` event (Vite / Next HMR live here).
 *
 * Security note: the proxy targets ONLY 127.0.0.1 inside the container's
 * network namespace, so it can't reach anything else on the network.  We
 * accept any port the URL specifies — the assumption is anyone with
 * collab access has effectively shell-level trust on the workspace
 * already (they can ask the LLM to run arbitrary commands).
 */

import { connect as netConnect } from "node:net"
import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { lookupCookieIdentityFromHeaders } from "./cookie-auth"

const PREVIEW_PREFIX = "/preview/"

/**
 * Parse `/preview/<port>/<rest>` out of an incoming URL.
 * Returns null if the URL doesn't match.
 */
export function parsePreviewPath(pathname: string): { port: number; rest: string } | null {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return null
  const after = pathname.slice(PREVIEW_PREFIX.length)
  const slash = after.indexOf("/")
  const portStr = slash === -1 ? after : after.slice(0, slash)
  const rest = slash === -1 ? "" : after.slice(slash) // keeps leading "/"
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, rest: rest || "/" }
}

/**
 * The Host header value we forward to dev servers behind /preview/<port>/*.
 *
 * `unleashlive/frontend`'s dev server runs with its CORS / hostname
 * assumptions tuned for `local.unleashlive.com:<port>` — that's the
 * canonical "local dev URL" inside the org.  We rewrite the Host header
 * to that value on every forwarded request so the dev server sees its
 * expected hostname even though the actual TCP connect is to literal
 * loopback (see PREVIEW_UPSTREAM_TCP_HOST below).
 *
 * Without this rewrite the upstream would see Host: 127.0.0.1:<port> and
 * any Vite/Webpack `server.allowedHosts` strictness OR runtime hostname
 * check inside the frontend would reject the request.
 */
const PREVIEW_UPSTREAM_HOST = "local.unleashlive.com"

/**
 * Where we actually open the TCP socket.  Dev servers always run on
 * loopback inside the same container; connecting to literal `127.0.0.1`
 * (vs. PREVIEW_UPSTREAM_HOST) removes the `/etc/hosts` resolution
 * dependency — which we can't satisfy on ECS anyway, because AWS
 * rejects container-level `extraHosts` for tasks with
 * `networkMode=awsvpc` ("Extra hosts are not supported on container
 * when networkMode=awsvpc").  See DEPLOYMENT.md → Frontend live-preview
 * loopback alias.
 *
 * The Host header is set separately above, so the wire value reaching
 * the dev server is unchanged from what it would have been with
 * /etc/hosts in play.
 */
const PREVIEW_UPSTREAM_TCP_HOST = "127.0.0.1"

function upstreamHostHeader(port: number): string {
  return `${PREVIEW_UPSTREAM_HOST}:${port}`
}

/**
 * Forward a plain HTTP request through to the dev server on
 * 127.0.0.1:<port>, rewriting the Host header to
 * `local.unleashlive.com:<port>` so the dev server sees its expected
 * hostname.  Returns a Response the collab middleware can hand back to
 * the browser.  Hop-by-hop headers are stripped; everything else passes
 * through.
 */
export async function handlePreviewHttp(req: Request, port: number, rest: string): Promise<Response> {
  const url = new URL(req.url)
  // TCP-connect to literal 127.0.0.1 (NOT the hostname alias).  Mirrors
  // the WebSocket path below — see PREVIEW_UPSTREAM_TCP_HOST for the
  // rationale (awsvpc bans container-level extraHosts, so an alias-
  // based fetch would ENOTFOUND on ECS).  The Host header rewrite
  // further down is what makes the dev server see its expected
  // hostname on the wire.
  const target = `http://${PREVIEW_UPSTREAM_TCP_HOST}:${port}${rest}${url.search}`

  // Strip hop-by-hop headers + the Host header (we set it ourselves below
  // so the dev server sees its expected hostname; the browser's original
  // Host header would otherwise leak collab.utils.unleashlive.com which
  // some dev servers reject).
  const headers = new Headers()
  for (const [name, value] of req.headers.entries()) {
    const lower = name.toLowerCase()
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "transfer-encoding" ||
      lower === "upgrade" ||
      lower === "proxy-authorization" ||
      lower === "proxy-authenticate" ||
      lower === "te" ||
      lower === "trailers"
    ) {
      continue
    }
    headers.set(name, value)
  }
  // Override the Host header explicitly.  Some fetch implementations
  // auto-set Host from the URL host; we set it anyway so the wire value
  // is unambiguous + we don't accidentally pass port as a separate
  // header field on weirder runtimes.
  headers.set("Host", upstreamHostHeader(port))
  // Tell the upstream what its public URL prefix is — apps that use this
  // (e.g. Vite with `--base`) can self-rewrite their links.
  headers.set("X-Forwarded-Prefix", `/preview/${port}`)
  headers.set("X-Forwarded-Host", url.host)
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""))

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : (req.body as BodyInit | null) ?? undefined,
      // Stream the response back without buffering.
      // @ts-expect-error — Bun supports this option even though node fetch typing omits it.
      redirect: "manual",
    })

    // Pass through the upstream's body (which may itself be a stream) and
    // headers as-is, minus anything hop-by-hop the upstream might have set.
    const respHeaders = new Headers(upstream.headers)
    respHeaders.delete("connection")
    respHeaders.delete("keep-alive")
    respHeaders.delete("transfer-encoding")
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title>` +
        `<div style="font-family:system-ui;margin:3rem auto;max-width:520px;line-height:1.5">` +
        `<h1 style="margin:0 0 .5rem 0">Preview unavailable</h1>` +
        `<p>Couldn't reach <code>127.0.0.1:${port}</code> from inside the workspace container.</p>` +
        `<p>Is a dev server actually listening on port ${port}?  In the iframe terminal:</p>` +
        `<pre style="background:#111;color:#eee;padding:.75rem;border-radius:6px">ss -lntp | grep ${port}</pre>` +
        `<p>If the dev server is up but this still 502s, check that it's bound to <code>0.0.0.0</code> (or <code>127.0.0.1</code>) rather than an external interface.  Vite/Webpack default to localhost-only, which is fine; <code>--host 0.0.0.0</code> works too.</p>` +
        `<p>Error: <code>${detail.replace(/</g, "&lt;")}</code></p>` +
        `</div>`,
      { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
    )
  }
}

/**
 * Wire the Node http.Server's `upgrade` event so WebSocket connections to
 * /preview/<port>/<rest> are TCP-proxied to 127.0.0.1:<port>.  This is what
 * makes Vite / Next HMR work — they all run over a single WS connection.
 *
 * We deliberately do NO frame-level interpretation; we just rewrite the
 * HTTP/1.1 request line + headers and then pipe sockets in both directions
 * until either side closes.
 */
export function attachPreviewUpgrade(server: {
  on: (event: "upgrade", listener: (req: IncomingMessage, socket: Socket, head: Buffer) => void) => void
}) {
  server.on("upgrade", (req, clientSocket, head) => {
    const url = req.url ?? "/"
    const pathname = url.split("?", 1)[0]!
    const parsed = parsePreviewPath(pathname)
    if (!parsed) {
      // Not ours — leave the socket alone so other upgrade listeners (e.g.
      // opencode's own WebSocket routes) can claim it.
      return
    }

    // Authenticate the WebSocket upgrade BEFORE the handshake completes.
    // The browser sees a clean 403 (vs a successful WS that immediately
    // closes with code 1008) and we never touch the WS framing layer for
    // unauthorised callers.  Cookie-only check — see ADR-0001; v1 doesn't
    // bind port to a specific session.
    const cookieHeader = (req.headers["cookie"] as string | undefined) ?? ""
    if (!lookupCookieIdentityFromHeaders(cookieHeader)) {
      try {
        clientSocket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      } catch {}
      try { clientSocket.destroy() } catch {}
      return
    }

    // TCP-connect to the loopback alias.  Resolved via /etc/hosts to
    // 127.0.0.1, but `netConnect` accepts hostnames so we can be explicit
    // about the intent.  Using `127.0.0.1` here would still work because
    // the Host header rewrite below is what the dev server actually sees;
    // the hostname only matters when the upstream is on a remote IP.
    // We use 127.0.0.1 for the TCP connect because it's strictly faster
    // (skips the DNS lookup) and the dev server is always loopback —
    // the hostname rewrite is purely for the Host header below.
    const upstreamSocket = netConnect({ host: "127.0.0.1", port: parsed.port })

    const cleanup = (err?: Error) => {
      if (err) {
        try {
          clientSocket.write(
            "HTTP/1.1 502 Bad Gateway\r\n" +
              "Connection: close\r\n" +
              "Content-Type: text/plain\r\n\r\n" +
              `Preview proxy upstream error: ${err.message}\r\n`,
          )
        } catch {}
      }
      try { clientSocket.destroy() } catch {}
      try { upstreamSocket.destroy() } catch {}
    }

    upstreamSocket.on("error", cleanup)
    clientSocket.on("error", cleanup)

    upstreamSocket.once("connect", () => {
      // Build the rewritten request line + headers.  Rewrite the URL by
      // stripping the /preview/<port> prefix; everything else (Sec-WebSocket-*
      // headers, Upgrade, Connection, Origin, etc.) passes through.
      const newUrl = (parsed.rest || "/") + (url.includes("?") ? url.slice(url.indexOf("?")) : "")
      const lines: string[] = [`${req.method ?? "GET"} ${newUrl} HTTP/1.1`]
      const raw = req.rawHeaders
      for (let i = 0; i < raw.length; i += 2) {
        const name = raw[i]!
        const value = raw[i + 1]!
        if (name.toLowerCase() === "host") {
          // Rewrite Host to the loopback alias so the dev server sees its
          // expected hostname — same rationale as in handlePreviewHttp.
          lines.push(`Host: ${upstreamHostHeader(parsed.port)}`)
        } else {
          lines.push(`${name}: ${value}`)
        }
      }
      upstreamSocket.write(lines.join("\r\n") + "\r\n\r\n")
      if (head && head.length) upstreamSocket.write(head)
      // Bidirectional pipe; once either side closes the other follows.
      clientSocket.pipe(upstreamSocket).pipe(clientSocket)
    })
  })
}
