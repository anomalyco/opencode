import { expect, test } from "bun:test"
import { PROBE_COOKIE } from "../cookie"
import { canSeeCookie, cookieInfo } from "./cookies"

test("an extension sees the cookies of hosts it has access to, on the scheme they are sent over", () => {
  const hosts = ["https://*.github.com/*", "http://localhost/*"]

  expect(canSeeCookie(hosts, { domain: ".github.com", path: "/", secure: true })).toBe(true)
  expect(canSeeCookie(hosts, { domain: "gist.github.com", path: "/", secure: false })).toBe(true)
  expect(canSeeCookie(hosts, { domain: "localhost", path: "/", secure: false })).toBe(true)
  expect(canSeeCookie(hosts, { domain: "localhost", path: "/", secure: true })).toBe(false)
  expect(canSeeCookie(hosts, { domain: "example.com", path: "/", secure: true })).toBe(false)
  expect(canSeeCookie(["<all_urls>"], { domain: "", path: "/", secure: false })).toBe(false)
})

test("no extension sees the profile's start-up cookie probe, even with access to every host", () => {
  expect(canSeeCookie(["<all_urls>"], { domain: PROBE_COOKIE.host, path: "/", secure: true })).toBe(false)
  expect(canSeeCookie(["<all_urls>"], { domain: "example.com", path: "/", secure: true })).toBe(true)
})

test("a cookie reads as chrome.cookies describes it", () => {
  expect(cookieInfo({ name: "a", value: "1", domain: ".x.com", sameSite: "lax" })).toEqual({
    name: "a",
    value: "1",
    domain: ".x.com",
    hostOnly: false,
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: "lax",
    session: true,
    expirationDate: undefined,
    storeId: "0",
  })
})
