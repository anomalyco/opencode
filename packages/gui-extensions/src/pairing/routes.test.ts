import { describe, expect, test } from "bun:test"
import { customAddress, pairingRoutes } from "./routes"

describe("pairing routes", () => {
  test("keeps addresses other devices can reach, custom first, then local network, then VPN", () => {
    expect(
      pairingRoutes(
        [
          "http://100.87.251.43:49374",
          "http://127.0.0.1:49374",
          "http://169.254.10.2:49374",
          "http://192.168.10.248:49374",
          "http://[fe80::1]:49374",
          "http://[fd7a:115c:a1e0::901:fb9d]:49374",
          "http://[fd12:3456::1]:49374",
          "http://203.0.113.4:49374",
          "http://0.0.0.0:49374",
        ],
        "https://opencode.example.com",
      ),
    ).toEqual([
      { url: "https://opencode.example.com", kind: "custom" },
      { url: "http://192.168.10.248:49374", kind: "local" },
      { url: "http://[fd12:3456::1]:49374", kind: "local" },
      { url: "http://169.254.10.2:49374", kind: "local" },
      { url: "http://100.87.251.43:49374", kind: "vpn" },
      { url: "http://[fd7a:115c:a1e0::901:fb9d]:49374", kind: "vpn" },
      { url: "http://203.0.113.4:49374", kind: "other" },
    ])
  })

  test("a stored custom address that is not an HTTP origin is ignored", () => {
    expect(pairingRoutes(["http://192.168.1.2:4096"], "not a url")).toEqual([
      { url: "http://192.168.1.2:4096", kind: "local" },
    ])
  })

  test("a server that only listens on this computer has no route", () => {
    expect(pairingRoutes(["http://127.0.0.1:49374", "http://localhost:49374"], "")).toEqual([])
  })

  test("a custom address that the server also advertises is listed once, as custom", () => {
    expect(pairingRoutes(["http://192.168.1.2:4096"], "http://192.168.1.2:4096")).toEqual([
      { url: "http://192.168.1.2:4096", kind: "custom" },
    ])
  })
})

describe("custom address", () => {
  test("accepts an HTTP or HTTPS origin", () => {
    expect(customAddress(" https://opencode.example.com/ ")).toBe("https://opencode.example.com")
    expect(customAddress("http://10.0.0.5:4096")).toBe("http://10.0.0.5:4096")
  })

  test("rejects anything a pairing link would rewrite or leak", () => {
    expect(customAddress("opencode.example.com")).toBeUndefined()
    expect(customAddress("ftp://opencode.example.com")).toBeUndefined()
    expect(customAddress("https://opencode.example.com/app")).toBeUndefined()
    expect(customAddress("https://opencode.example.com/?a=1")).toBeUndefined()
    expect(customAddress("https://opencode.example.com/#a")).toBeUndefined()
    expect(customAddress("https://user:pass@opencode.example.com")).toBeUndefined()
  })
})
