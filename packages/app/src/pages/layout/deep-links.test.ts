import { describe, expect, test } from "bun:test"
import { collectConnectToDeepLinks, drainConnectToDeepLinks, parseConnectToDeepLink } from "./deep-links"

describe("parseConnectToDeepLink", () => {
  test("parses a loopback uri with a request id", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://127.0.0.1:51234&request=abc")).toEqual({
      uri: "http://127.0.0.1:51234",
      request: "abc",
    })
  })

  test("accepts a localhost uri", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://localhost:4096&request=abc")).toEqual({
      uri: "http://localhost:4096",
      request: "abc",
    })
  })

  test("accepts an IPv6 loopback uri", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://[::1]:4096&request=abc")).toEqual({
      uri: "http://[::1]:4096",
      request: "abc",
    })
  })

  test("carries an optional name", () => {
    expect(
      parseConnectToDeepLink("opencode://connect-to?uri=http://127.0.0.1:51234&name=my-server&request=abc"),
    ).toEqual({
      uri: "http://127.0.0.1:51234",
      name: "my-server",
      request: "abc",
    })
  })

  test("requires a request id", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://127.0.0.1:1")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://127.0.0.1:1&request=")).toBeUndefined()
  })

  test("ignores non-connect-to deep links", () => {
    expect(parseConnectToDeepLink("opencode://open-project?directory=/tmp")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://new-session?directory=/tmp")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://connectto?uri=http://127.0.0.1:1&request=abc")).toBeUndefined()
  })

  test("ignores non-opencode urls", () => {
    expect(parseConnectToDeepLink("https://evil.example/connect-to?uri=http://127.0.0.1:1&request=abc")).toBeUndefined()
  })

  test("requires a uri", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?request=abc")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://connect-to?name=x&request=abc")).toBeUndefined()
  })

  test("rejects a non-loopback uri (defense-in-depth against pointing the app at a remote host)", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://10.0.0.5:4096&request=abc")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://connect-to?uri=https://evil.example&request=abc")).toBeUndefined()
    expect(parseConnectToDeepLink("opencode://connect-to?uri=http://127.0.0.1.evil.com:80&request=abc")).toBeUndefined()
  })

  test("rejects a uri with embedded userinfo (would display a misleading host)", () => {
    expect(
      parseConnectToDeepLink("opencode://connect-to?uri=http://real-server.example@127.0.0.1:80&request=abc"),
    ).toBeUndefined()
  })

  test("rejects a non-http uri scheme", () => {
    expect(parseConnectToDeepLink("opencode://connect-to?uri=file:///etc/passwd&request=abc")).toBeUndefined()
  })
})

describe("collectConnectToDeepLinks", () => {
  test("keeps only valid connect-to links", () => {
    const links = collectConnectToDeepLinks([
      "opencode://connect-to?uri=http://127.0.0.1:1&name=a&request=r1",
      "opencode://open-project?directory=/tmp",
      "opencode://connect-to?uri=http://10.0.0.1:2&request=r2",
      "opencode://connect-to?uri=http://localhost:3&request=r3",
      "opencode://connect-to?uri=http://localhost:4",
    ])
    expect(links).toEqual([
      { uri: "http://127.0.0.1:1", name: "a", request: "r1" },
      { uri: "http://localhost:3", request: "r3" },
    ])
  })
})

describe("drainConnectToDeepLinks", () => {
  test("removes only connect-to links, leaving other types buffered", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: [
          "opencode://connect-to?uri=http://127.0.0.1:1&request=r1",
          "opencode://open-project?directory=/tmp",
          "opencode://new-session?directory=/tmp&prompt=hi",
        ],
      },
    }
    const drained = drainConnectToDeepLinks(target)
    expect(drained).toEqual(["opencode://connect-to?uri=http://127.0.0.1:1&request=r1"])
    expect(target.__OPENCODE__.deepLinks).toEqual([
      "opencode://open-project?directory=/tmp",
      "opencode://new-session?directory=/tmp&prompt=hi",
    ])
  })

  test("returns empty and leaves buffer untouched when there are no connect-to links", () => {
    const target = { __OPENCODE__: { deepLinks: ["opencode://open-project?directory=/tmp"] } }
    expect(drainConnectToDeepLinks(target)).toEqual([])
    expect(target.__OPENCODE__.deepLinks).toEqual(["opencode://open-project?directory=/tmp"])
  })
})
