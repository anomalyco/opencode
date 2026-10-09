export * as ServerAddress from "./server-address"

import { HttpServer } from "effect/unstable/http"

// `HttpServer.formatAddress` writes a TCP hostname through verbatim, so an IPv6 literal comes back
// unbracketed: `http://::1:22014`. That is not a parseable URL, and every reader of the value
// (`new URL` on the registration file, the client resolving the managed service) rejects it.
// Bracket the literal before handing the address anywhere it is read back.
// Bracketing does not cover a zone-scoped link-local bind: the WHATWG parser rejects zone identifiers
// (`http://[fe80::1%eth0]:22014` and the RFC 6874 `%25` spelling both fail to parse), so such a bind
// has no readable URL form at all. Bound hosts are loopback or routable in practice.
export const formatAddress = (address: HttpServer.Address): string =>
  address._tag === "TcpAddress" && address.hostname.includes(":")
    ? `http://[${address.hostname}]:${address.port}`
    : HttpServer.formatAddress(address)
