import { expect, test } from "bun:test"
import { displayHost, hostDisplay } from "./host-display"

test("draws the real web authority independently of the path and in ASCII", () => {
  expect(hostDisplay("https://accounts.example.com.long.tenant.example.co.uk/docs?x#y")).toEqual({
    scheme: "https://",
    host: "accounts.example.com.long.tenant.example.co.uk",
    rest: "/docs?x#y",
  })
  expect(hostDisplay("https://bücher.de/")?.host).toBe("xn--bcher-kva.de")
  expect(hostDisplay("http://[::1]:1234/path")?.host).toBe("[::1]:1234")
  expect(hostDisplay("https://label@example.test/")).toBeUndefined()
  expect(hostDisplay("workspace://session/path")).toBeUndefined()
  // The address bar keeps the whole host and elides it from the left itself.
  expect(hostDisplay(`https://${"a".repeat(80)}.example.com/`)?.host).toBe(`${"a".repeat(80)}.example.com`)
})

test("shows the end of every host it names, where the registrable domain is, in one formatter", () => {
  const phish = "https://sso.corp.example.com.auth-portal-session-verify.account-security-check.evil.test:8443/auth"
  const host = displayHost(phish)

  expect(host.length).toBeLessThanOrEqual(64)
  expect(host.endsWith(".evil.test:8443")).toBe(true)
  expect(host.startsWith("…")).toBe(true)
  expect(displayHost("https://bücher.example/")).toBe("xn--bcher-kva.example")
  expect(displayHost("http://127.0.0.1:7821")).toBe("127.0.0.1:7821")
  expect(displayHost("not a url")).toBe("")
})
