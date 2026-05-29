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
import { connect as tlsConnect } from "node:tls"
import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { lookupCookieIdentityFromHeaders } from "./cookie-auth"
import { getActiveUpstreamScheme } from "./preview-launcher"

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
 * Forward an HTTP request through to the dev server on 127.0.0.1:<port>
 * while presenting Host: local.unleashlive.com:<port> on the wire.
 * Returns a Response the collab middleware can hand back to the browser.
 * Hop-by-hop headers are stripped; everything else passes through.
 *
 * URL uses the literal loopback IP (`PREVIEW_UPSTREAM_TCP_HOST`) so the
 * TCP connect doesn't depend on /etc/hosts (incompatible with ECS awsvpc
 * — see the constant's docstring).  Bun's fetch preserves the user-set
 * Host header, so the dev server still sees the expected hostname.
 *
 * Transport (http vs https) is picked per-active-preview via
 * `getActiveUpstreamScheme(port)` — opt-in for repos whose
 * `.opencode-preview.json` sets `"upstreamScheme": "https"` (Angular CLI
 * --ssl, Vite --https, CRA HTTPS=true, …).  Default "http" keeps every
 * existing repo unchanged.  TLS uses `rejectUnauthorized: false` because
 * the connect target is literal 127.0.0.1 in the same container — there
 * is no MITM surface to defend against, and chained cert verification
 * against an IP literal isn't possible anyway.
 */
export async function handlePreviewHttp(req: Request, port: number, rest: string): Promise<Response> {
  const url = new URL(req.url)
  const scheme = getActiveUpstreamScheme(port)
  const target = `${scheme}://${PREVIEW_UPSTREAM_TCP_HOST}:${port}${rest}${url.search}`

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
      // Bun-specific: when scheme === "https" the dev server's cert is
      // a self-signed in-container blob (e.g. ssl/cert.pem from the repo).
      // We're connecting to literal 127.0.0.1 — no MITM surface, and chain
      // validation against an IP literal is impossible.  Accept any cert.
      // For scheme === "http" this option is a harmless no-op.
      // Future fallback if Bun ever drops this init field: node:https
      // `https.request()` with `rejectUnauthorized: false` in agent options.
      // @ts-expect-error — Bun-only fetch init field, not in standard typings.
      tls: { rejectUnauthorized: false },
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
    // Hint at scheme mismatch — common 502 cause once HTTPS-upstream support
    // exists.  Two cases:
    //   - Proxy is configured "http" (default) but the dev server bound TLS
    //     → the byte-level "Unable to connect" / EPROTO from TLS handshake
    //       failure surfaces as a 502 here.  Set `upstreamScheme: "https"`.
    //   - Proxy is configured "https" but the dev server is plain HTTP
    //     → similar shape, opposite direction.  Drop `upstreamScheme` or
    //       set it to "http".
    const schemeHint =
      scheme === "https"
        ? `<p><em>Proxy is configured to speak HTTPS to the upstream.  If the dev server is actually plain HTTP, drop <code>"upstreamScheme"</code> from <code>.opencode-preview.json</code> (or set it to <code>"http"</code>).</em></p>`
        : `<p><em>If the dev server runs TLS in-container (Angular CLI <code>--ssl</code>, Vite <code>--https</code>, CRA <code>HTTPS=true</code>), add <code>"upstreamScheme": "https"</code> to <code>.opencode-preview.json</code>.</em></p>`
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title>` +
        `<div style="font-family:system-ui;margin:3rem auto;max-width:560px;line-height:1.5">` +
        `<h1 style="margin:0 0 .5rem 0">Preview unavailable</h1>` +
        `<p>Couldn't reach <code>${scheme}://${PREVIEW_UPSTREAM_TCP_HOST}:${port}</code> from inside the workspace container.</p>` +
        `<p>Is a dev server actually listening on port ${port}?  In the iframe terminal:</p>` +
        `<pre style="background:#111;color:#eee;padding:.75rem;border-radius:6px">ss -lntp | grep ${port}</pre>` +
        `<p>If the dev server is up but this still 502s, check that it's bound to <code>0.0.0.0</code> (or <code>127.0.0.1</code>) rather than an external interface.  Vite/Webpack default to localhost-only, which is fine; <code>--host 0.0.0.0</code> works too.</p>` +
        schemeHint +
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

    // Connect to the loopback dev server.  Plain TCP for the default
    // "http" upstream, TLS for the opt-in "https" upstream (Angular CLI
    // --ssl etc.).  Both `netConnect` and `tlsConnect` return a Duplex
    // with identical .write / .on('data') / .pipe() surface, so the rest
    // of this handler (the handshake-write below + the bidirectional
    // pipe at the bottom) doesn't need to branch.
    //
    // `rejectUnauthorized: false` for TLS: we're connecting to literal
    // 127.0.0.1 inside the same container — no MITM surface to defend
    // against, and chain validation against an IP literal is impossible
    // anyway.  See `handlePreviewHttp`'s tls option for the matching
    // rationale on the HTTP path.
    const upstreamScheme = getActiveUpstreamScheme(parsed.port)
    const upstreamSocket: Socket =
      upstreamScheme === "https"
        ? (tlsConnect({ host: "127.0.0.1", port: parsed.port, rejectUnauthorized: false }) as unknown as Socket)
        : netConnect({ host: "127.0.0.1", port: parsed.port })

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

    // For plain TCP, "connect" fires when the three-way handshake completes.
    // For TLS, "connect" only signals TCP; we want "secureConnect" which
    // fires after the TLS handshake (writes before secureConnect would be
    // buffered + flushed plaintext-over-TLS in a way that worked by
    // accident but is brittle).  One handler, picked once.
    const upstreamReady = upstreamScheme === "https" ? "secureConnect" : "connect"
    upstreamSocket.once(upstreamReady, () => {
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
