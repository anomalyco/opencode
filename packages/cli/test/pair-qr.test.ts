import { expect, test } from "bun:test"
import { qrLines } from "../src/commands/handlers/pair"

test("pair prints a QR code for the reachable addresses, even with many container bridges", () => {
  const bridges = Array.from({ length: 84 }, (_, i) => `http://172.${17 + (i % 15)}.${i}.1:4096`)
  const lines = qrLines("abc_DEF-123_4567890123", ["http://127.0.0.1:4096", "http://192.168.1.2:4096", ...bridges])

  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain("▀")
})

test("pair leaves the QR code out when no address fits one, and says why", () => {
  expect(qrLines("abc", ["http://127.0.0.1:4096"])).toEqual([])
  expect(qrLines("abc", ["http://127.0.0.1:4096", `http://${"a".repeat(400)}.example:4096`])).toEqual([
    "",
    "  The addresses are too long for a QR code; open a link instead.",
  ])
})
