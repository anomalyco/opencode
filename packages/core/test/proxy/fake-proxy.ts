import { createServer, type Server } from "node:http"
import { connect } from "node:net"

export interface FakeProxy {
  url: URL
  /** Every `Proxy-Authorization` value observed, in order. */
  requests: string[]
  close(): Promise<void>
}

export interface FakeProxyOptions {
  schemes: ("Negotiate" | "NTLM" | "Basic")[]
  accept: (scheme: string, header: string) => boolean
}

function schemeOf(header: string | undefined): string {
  return (header ?? "").split(/\s/, 1)[0].toLowerCase()
}

/**
 * A minimal authenticating HTTP proxy for tests. It answers `CONNECT` and plain
 * requests with `407` + `Proxy-Authenticate` until an accepted
 * `Proxy-Authorization` arrives, then `200`, then tunnels.
 */
export async function startFakeProxy(options: FakeProxyOptions): Promise<FakeProxy> {
  const requests: string[] = []
  const server: Server = createServer()

  server.on("request", (req, res) => {
    const header = req.headers["proxy-authorization"]
    if (typeof header === "string") requests.push(header)
    const scheme = schemeOf(header)
    if (header && options.accept(scheme, header)) {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("proxied")
      return
    }
    res.writeHead(407, {
      "proxy-authenticate": options.schemes.map((value) => `${value}`).join(", "),
      "content-type": "text/html",
    })
    res.end("Authentication Required")
  })

  server.on("connect", (req, clientSocket, head) => {
    const header = req.headers["proxy-authorization"]
    if (typeof header === "string") requests.push(header)
    const scheme = schemeOf(header)
    if (!header || !options.accept(scheme, header)) {
      clientSocket.write(
        "HTTP/1.1 407 Proxy Authentication Required\r\n" +
          options.schemes.map((value) => `Proxy-Authenticate: ${value}`).join("\r\n") +
          "\r\n\r\n",
      )
      clientSocket.destroy()
      return
    }
    const [host, port] = (req.url ?? "").split(":")
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    const upstream = connect(Number(port) || 443, host)
    upstream.on("connect", () => {
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on("error", () => clientSocket.destroy())
    clientSocket.on("error", () => upstream.destroy())
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0

  return {
    url: new URL(`http://127.0.0.1:${port}`),
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
