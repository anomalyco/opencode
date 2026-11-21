import { renderUnicodeCompact } from "@opencode/util/qr"
import { expect, test } from "bun:test"
import { qrPayload } from "../src/commands/handlers/pair"

const code = "Zm9vYmFyYmF6cXV4MTIzNA"

test("the QR payload carries every reachable address of an ordinary host", () => {
  expect(qrPayload(code, ["http://127.0.0.1:4096", "http://192.168.1.20:4096", "http://10.0.0.5:4096"])).toBe(
    JSON.stringify({ code, urls: ["http://192.168.1.20:4096", "http://10.0.0.5:4096"] }),
  )
})

test("a loopback-only server has no QR payload", () => {
  expect(qrPayload(code, ["http://127.0.0.1:4096", "http://localhost:4096", "http://[::1]:4096"])).toBeUndefined()
})

// A host with one bridge per Docker network returned 110 addresses, more than a QR code can hold.
test("the QR payload still renders on a host with over a hundred addresses", () => {
  const urls = [
    "http://127.0.0.1:4096",
    "http://192.168.1.20:4096",
    ...Array.from({ length: 109 }, (_, i) => `http://172.100.${i}.1:4096`),
  ]
  const payload = qrPayload(code, urls) ?? ""
  expect(() => renderUnicodeCompact(payload, { border: 2 })).not.toThrow()
  expect(JSON.parse(payload)).toEqual({ code, urls: urls.slice(1, 9) })
})
