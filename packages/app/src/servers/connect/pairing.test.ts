import { expect, test } from "bun:test"
import { readPairing } from "./pairing"

test("prefers public URLs and tailnet addresses without changing credentials", () => {
  const info = {
    urls: [
      "https://localhost:49374",
      "http://192.168.1.20:49374",
      "http://100.100.10.20:49374",
      "http://server.example.test",
      "https://server.example.test",
      "https://laptop.tailnet.ts.net",
    ],
    username: "opencode",
    password: "password:with spaces",
  }
  expect(readPairing(JSON.stringify(info))).toEqual({
    ...info,
    urls: [
      "https://server.example.test",
      "http://server.example.test",
      "https://laptop.tailnet.ts.net",
      "http://100.100.10.20:49374",
      "http://192.168.1.20:49374",
      "https://localhost:49374",
    ],
  })
})

test("ranks IPv6 scopes and puts bind-only addresses last", () => {
  const urls = [
    "http://[::]:49374",
    "http://[::1]:49374",
    "http://[fe80::1]:49374",
    "http://[fd00::1]:49374",
    "http://[fd7a:115c:a1e0::1]:49374",
    "http://[2606:4700:4700::1111]:49374",
  ]
  expect(readPairing(JSON.stringify({ urls, username: "opencode", password: "secret" }))?.urls).toEqual(
    urls.toReversed(),
  )
})

test("keeps equivalent addresses in their original order", () => {
  const urls = ["http://172.16.0.2:49374", "http://10.0.0.2:49374", "http://192.168.1.2:49374"]
  expect(readPairing(JSON.stringify({ urls, username: "opencode", password: "secret" }))?.urls).toEqual(urls)
})

test("classifies IPv4-mapped IPv6 addresses with their IPv4 scope", () => {
  const urls = ["http://[::ffff:127.0.0.1]:49374", "http://[::ffff:192.168.1.20]:49374", "http://100.64.0.1:49374"]
  expect(readPairing(JSON.stringify({ urls, username: "opencode", password: "secret" }))?.urls).toEqual(
    urls.toReversed(),
  )
})

test("rejects unrelated QR contents and invalid pairing details", () => {
  expect(readPairing("not json")).toBeUndefined()
  const info = { urls: ["http://127.0.0.1:49374"], username: "opencode", password: "secret" }
  const invalid = [
    null,
    {},
    { ...info, urls: [] },
    { ...info, urls: ["not a URL"] },
    { ...info, urls: ["file:///etc/passwd"] },
    { ...info, urls: ["https://user:password@example.test"] },
    { ...info, username: 42 },
    { ...info, password: "" },
  ]
  invalid.forEach((value) => expect(readPairing(JSON.stringify(value))).toBeUndefined())
})
