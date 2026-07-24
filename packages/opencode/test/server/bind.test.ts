// Unit tests for bind-failure diagnostics. These exist because the two failure
// modes they cover are invisible at runtime: Effect's `ServeError` has an empty
// `message`, and Bun's `node:http` reports every listen error as EADDRINUSE. A
// regression here degrades silently to "Unexpected error / ServeError".
import { describe, expect, test } from "bun:test"
import type { networkInterfaces } from "node:os"
import { assertBindable, bindError, localAddresses } from "../../src/server/bind"

type Interfaces = ReturnType<typeof networkInterfaces>

// Only `address` is read; the rest of NetworkInterfaceInfo is noise here.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- partial fixture, `address` is the only field under test
const INTERFACES = {
  lo0: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true },
  ],
  en0: [
    { address: "192.168.0.40", family: "IPv4", internal: false },
    { address: "fe80::1c52:8bff:fe2e:29fe", family: "IPv6", internal: false },
  ],
} as unknown as Interfaces

// Mirrors Effect's `HttpServerError.ServeError`: a tagged error with an empty
// message that hides the real failure on `.cause`.
function serveError(cause: unknown) {
  const error = new Error("")
  error.name = "ServeError"
  Object.assign(error, { _tag: "ServeError", cause })
  return error
}

function errno(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

describe("server.bind", () => {
  describe("assertBindable", () => {
    test("allows wildcard and loopback hosts", () => {
      for (const hostname of ["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"]) {
        expect(() => assertBindable({ hostname, port: 4096 }, INTERFACES)).not.toThrow()
      }
    })

    test("allows an address owned by a local interface", () => {
      expect(() => assertBindable({ hostname: "192.168.0.40", port: 4096 }, INTERFACES)).not.toThrow()
    })

    test("rejects an IP no interface owns, and lists what is available", () => {
      // A Tailscale CGNAT address with the interface down — the reported case.
      const bind = () => assertBindable({ hostname: "100.68.120.26", port: 4096 }, INTERFACES)
      expect(bind).toThrow(/not an address on any local network interface/)
      // The message has to be actionable, not just accurate.
      expect(bind).toThrow(/192\.168\.0\.40/)
      expect(bind).toThrow(/0\.0\.0\.0/)
    })

    test("ignores DNS names — listen() resolves those", () => {
      expect(() => assertBindable({ hostname: "example.internal", port: 4096 }, INTERFACES)).not.toThrow()
    })

    test("matches link-local IPv6 written with a zone id", () => {
      expect(() =>
        assertBindable({ hostname: "fe80::1c52:8bff:fe2e:29fe%en0", port: 4096 }, INTERFACES),
      ).not.toThrow()
    })
  })

  test("localAddresses dedupes and flattens", () => {
    expect(localAddresses(INTERFACES)).toEqual(["127.0.0.1", "::1", "192.168.0.40", "fe80::1c52:8bff:fe2e:29fe"])
  })

  describe("bindError", () => {
    const target = { hostname: "127.0.0.1", port: 4096 }

    test("unwraps an errno buried under ServeError", () => {
      const error = bindError(serveError(errno("EADDRINUSE", "address already in use")), target)
      expect(error.message).toContain("127.0.0.1:4096 is already in use")
      expect(error.message).not.toContain("ServeError")
    })

    test("blames privileges, not a conflict, for ports below 1024", () => {
      // Bun folds EACCES into EADDRINUSE, so the errno alone would mislead here.
      const error = bindError(serveError(errno("EADDRINUSE", "in use?")), { hostname: "127.0.0.1", port: 80 })
      expect(error.message).toContain("privileged")
    })

    test("maps EADDRNOTAVAIL to the hostname, not the port", () => {
      const error = bindError(serveError(errno("EADDRNOTAVAIL", "address not available")), {
        hostname: "100.68.120.26",
        port: 4096,
      })
      expect(error.message).toContain("not an address on this machine")
    })

    test("maps EACCES", () => {
      const error = bindError(serveError(errno("EACCES", "permission denied")), { hostname: "127.0.0.1", port: 443 })
      expect(error.message).toContain("Permission denied")
    })

    test("falls back to the deepest cause message when the errno is unknown", () => {
      const error = bindError(serveError(new Error("socket exploded")), target)
      expect(error.message).toBe("Failed to start server on 127.0.0.1:4096: socket exploded")
    })

    test("never loses the original error", () => {
      const original = serveError(errno("EADDRINUSE", "in use"))
      expect(bindError(original, target).cause).toBe(original)
    })

    test("terminates on a self-referential cause chain", () => {
      const looped: { cause?: unknown } = {}
      looped.cause = looped
      // Would hang without the `seen` guard; reaching the assertion is the test.
      expect(bindError(looped, target).message).toBe("Failed to start server on 127.0.0.1:4096")
    })
  })
})
