export * as ServerAddress from "./server-address"

import { HttpServer } from "effect/unstable/http"

// `HttpServer.formatAddress` writes a TCP hostname through verbatim, so an IPv6 literal comes back
// unbracketed: `http://::1:22014`. That is not a parseable URL, and every reader of the value
// (`new URL` on the registration file, the client resolving the managed service) rejects it.
// Bracket the literal before handing the address anywhere it is read back.
export const formatAddress = (address: HttpServer.Address): string =>
  address._tag === "TcpAddress" && address.hostname.includes(":")
    ? `http://[${address.hostname}]:${address.port}`
    : HttpServer.formatAddress(address)
