/**
 * `fetch` over an unencrypted Unix domain socket. The URL supplies the request path, method and headers, and must use
 * `http:`; its host and port are ignored and the socket is dialed directly, so no TCP port is opened or reached.
 * Redirects are not followed: a redirect target would be a normal TCP request.
 */
export const unixSocketFetch = (socketPath: string): typeof fetch => {
  if (socketPath.length === 0)
    return (() => Promise.reject(new TypeError("Unix socket path must not be empty"))) as unknown as typeof fetch
  // Node's fetch has no socket option, and a hand-written node:http client would be untested code in a Bun-first CLI.
  // Reject clearly instead of letting the request fall back to the URL's TCP host.
  if (typeof Bun === "undefined")
    return (() => Promise.reject(new TypeError("Unix socket transport requires the Bun runtime"))) as unknown as typeof fetch
  return ((input, init) => {
    const protocol = new URL(input instanceof Request ? input.url : String(input)).protocol
    if (protocol !== "http:") return Promise.reject(unsupportedProtocol(protocol))
    return fetch(input, { ...init, unix: socketPath, redirect: "manual" })
  }) as typeof fetch
}

const unsupportedProtocol = (protocol: string) =>
  new TypeError(`Unix socket transport requires an http URL, received ${protocol}`)
