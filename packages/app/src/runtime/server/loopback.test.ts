import { expect, test } from "bun:test"
import { sameLoopbackServer } from "./loopback"

// The window's "local server" and main's "pages share the browser profile" both read this, so they cannot disagree.
test.each([
  { url: "http://127.0.0.1:4096", own: "http://127.0.0.1:4096", expected: true },
  { url: "http://localhost:4096", own: "http://127.0.0.1:4096", expected: true },
  { url: "http://[::1]:4096/", own: "http://127.0.0.1:4096", expected: true },
  // Another loopback port may be a WSL server, a tunnel or a container with its own disk.
  { url: "http://localhost:4097", own: "http://127.0.0.1:4096", expected: false },
  { url: "https://127.0.0.1:4096", own: "http://127.0.0.1:4096", expected: false },
  { url: "http://192.168.1.2:4096", own: "http://127.0.0.1:4096", expected: false },
  { url: "http://localhost:4096", own: undefined, expected: false },
  { url: "not a url", own: "http://127.0.0.1:4096", expected: false },
])("$url is the app's own server at $own: $expected", (row) => {
  expect(sameLoopbackServer(row.url, row.own)).toBe(row.expected)
})
