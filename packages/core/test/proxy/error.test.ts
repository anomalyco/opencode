import { expect, test } from "bun:test"
import { ProxyAuthError, scrubProxy } from "../../src/proxy/error"

test("no-credentials error names the mechanism and suggests a fix", () => {
  const error = new ProxyAuthError("no-credentials", { proxy: "http://p:8080" })
  expect(error.message).toContain("Negotiate/NTLM/Basic")
})

test("credentials never appear in error text or properties", () => {
  const error = new ProxyAuthError("rejected", { proxy: "http://u:secret@proxy:8080" })
  expect(error.message).not.toContain("secret")
  expect(error.proxy).not.toContain("secret")
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("secret")
})

test("scrubProxy removes userinfo but keeps host and port", () => {
  expect(scrubProxy("http://u:secret@proxy:8080")).toBe("http://proxy:8080/")
})
