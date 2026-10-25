import { expect, test } from "bun:test"
import { authServerName } from "./remote"

const contributed = {
  type: "extension",
  key: "ssh:production",
  extension: "ssh",
  state: "ready",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  http: { url: "http://127.0.0.1:4096" },
} as const

test("SSH disclosure uses the remote identity even with a loopback proxy", () => {
  expect(authServerName({ ...contributed, displayName: "Production server" })).toBe("Production server")
})

test.each([
  {
    name: "local Desktop",
    server: { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } } as const,
    expected: undefined,
  },
  {
    name: "localhost HTTP",
    server: { type: "http", http: { url: "http://localhost:4096" } } as const,
    expected: undefined,
  },
  {
    name: "IPv4 loopback HTTP",
    server: { type: "http", http: { url: "http://127.0.0.1:4096" } } as const,
    expected: undefined,
  },
  {
    name: "IPv6 loopback HTTP",
    server: { type: "http", http: { url: "http://[::1]:4096" } } as const,
    expected: undefined,
  },
  {
    name: "WSL",
    server: { ...contributed, key: "wsl:Ubuntu", extension: "wsl", displayName: "Ubuntu" } as const,
    expected: "Ubuntu",
  },
  {
    name: "remote HTTP",
    server: { type: "http", http: { url: "https://production.example" } } as const,
    expected: "production.example",
  },
])("remote disclosure for a $name connection names $expected", ({ server, expected }) => {
  expect(authServerName(server)).toBe(expected)
})
