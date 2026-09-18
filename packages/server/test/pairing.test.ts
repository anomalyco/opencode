import { describe, expect, test } from "bun:test"
import { tailscaleUrls } from "../src/pairing"

describe("Tailscale Serve output", () => {
  test("extracts and deduplicates HTTPS addresses", () => {
    expect(
      tailscaleUrls(`
Available within your tailnet:
https://computer.example.ts.net/
|-- https://computer.example.ts.net
|--> http://127.0.0.1:4096
`),
    ).toEqual(["https://computer.example.ts.net"])
  })

  test("selects only the OpenCode HTTPS port", () => {
    expect(
      tailscaleUrls(
        "https://computer.example.ts.net\nhttps://computer.example.ts.net:8443\nhttps://computer.example.ts.net:49152",
        49152,
      ),
    ).toEqual(["https://computer.example.ts.net:49152"])
  })
})
