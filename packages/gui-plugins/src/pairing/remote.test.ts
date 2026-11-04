import { expect, test } from "bun:test"
import { remoteAddress } from "./remote"

test.each([
  [
    "the tunnel among the server's own addresses",
    [
      "http://127.0.0.1:49374",
      "http://192.168.10.248:49374",
      "http://100.87.251.43:49374",
      "https://cbf8424f2044b16d.vcybm3xt4hhu.opentunnel.xyz",
    ],
    "https://cbf8424f2044b16d.vcybm3xt4hhu.opentunnel.xyz",
  ],
  ["nothing while the tunnel is off or still connecting", ["http://127.0.0.1:49374", "http://192.168.10.248:49374"], undefined],
  ["nothing from a malformed address", ["not a url"], undefined],
])("remote address: %s", (_, urls, expected) => {
  expect(remoteAddress(urls)).toBe(expected)
})
