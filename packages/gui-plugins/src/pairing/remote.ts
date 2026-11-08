/**
 * The origin another device opens to reach this machine from anywhere, or undefined while the server advertises none.
 * The server itself listens over plain HTTP, so the HTTPS address among its URLs is its remote access tunnel.
 */
export function remoteAddress(urls: readonly string[]) {
  return urls.map((value) => URL.parse(value)).find((url) => url?.protocol === "https:")?.origin
}
