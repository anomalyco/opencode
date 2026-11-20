import { expect, test } from "bun:test"
import { browserUserAgent, chromiumTime, cookieDetails, parseCookieFile, type ImportedCookie } from "./cookie"

const cookie = (fields: Partial<ImportedCookie>): ImportedCookie => ({
  host: ".github.com",
  name: "user_session",
  value: "secret",
  path: "/",
  secure: true,
  httpOnly: true,
  expires: 2_000_000_000,
  sameSite: "lax",
  ...fields,
})

test("reads every cookie export format people bring: Netscape, Chrome's cookies API and Playwright", () => {
  const netscape = [
    "# Netscape HTTP Cookie File",
    "",
    "#HttpOnly_.github.com\tTRUE\t/\tTRUE\t2000000000\tuser_session\tsecret",
    "example.com\tFALSE\t/docs\tFALSE\t0\ttheme\tdark\tmode",
    "broken line",
  ].join("\n")

  expect(parseCookieFile(netscape)).toEqual({
    cookies: [
      cookie({ sameSite: "unspecified" }),
      cookie({
        host: "example.com",
        name: "theme",
        value: "dark\tmode",
        path: "/docs",
        secure: false,
        httpOnly: false,
        expires: undefined,
        sameSite: "unspecified",
      }),
    ],
    protected: 0,
    failed: 1,
  })

  const chrome = JSON.stringify([
    {
      domain: "github.com",
      hostOnly: true,
      name: "user_session",
      value: "secret",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expirationDate: 2_000_000_000,
      storeId: "0",
    },
    { domain: ".example.com", name: "s", value: "1", session: true, sameSite: "no_restriction", expirationDate: 5 },
  ])

  expect(parseCookieFile(chrome)?.cookies).toEqual([
    cookie({ host: "github.com" }),
    cookie({
      host: ".example.com",
      name: "s",
      value: "1",
      secure: false,
      httpOnly: false,
      expires: undefined,
      sameSite: "no_restriction",
    }),
  ])

  const playwright = JSON.stringify({
    cookies: [{ name: "sid", value: "x", domain: ".example.com", path: "/", expires: -1, sameSite: "Strict" }],
    origins: [],
  })

  expect(parseCookieFile(playwright)?.cookies).toEqual([
    cookie({
      host: ".example.com",
      name: "sid",
      value: "x",
      secure: false,
      httpOnly: false,
      expires: undefined,
      sameSite: "strict",
    }),
  ])

  expect(parseCookieFile("not a cookie file")).toBeUndefined()
  expect(parseCookieFile('{"cookies": "nope"}')).toBeUndefined()
})

test("writes a cookie as the browser stored it: host-only, domain, expiry and its prefix rules", () => {
  const now = 1_000_000_000

  expect(cookieDetails(cookie({}), now)).toEqual({
    url: "https://github.com/",
    name: "user_session",
    value: "secret",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    domain: ".github.com",
    expirationDate: 2_000_000_000,
  })
  // Host-only cookies take their host from the URL, and `__Host-` cookies may never name a domain.
  expect(cookieDetails(cookie({ host: "github.com" }), now)).not.toHaveProperty("domain")
  expect(cookieDetails(cookie({ name: "__Host-session" }), now)).not.toHaveProperty("domain")
  expect(cookieDetails(cookie({ expires: undefined }), now)).not.toHaveProperty("expirationDate")
  expect(cookieDetails(cookie({ host: "::1", secure: false, path: "" }), now)?.url).toBe("http://[::1]/")
  // Nothing a browser would send again: expired, nameless and empty, or without a host.
  expect(cookieDetails(cookie({ expires: now - 1 }), now)).toBeUndefined()
  expect(cookieDetails(cookie({ name: "", value: "" }), now)).toBeUndefined()
  expect(cookieDetails(cookie({ host: "." }), now)).toBeUndefined()
})

test("Chromium timestamps count microseconds from 1601, and zero means none", () => {
  expect(chromiumTime(13_300_000_000_000_000)).toBe(1_655_526_400)
  expect(chromiumTime(13_300_000_000_000_000n)).toBe(1_655_526_400)
  expect(chromiumTime(0)).toBeUndefined()
})

test("the profile's user agent is Chromium's, without the app and Electron tokens sign-in pages refuse", () => {
  expect(
    browserUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenCode/2.2.5 Chrome/140.0.7339.80 Electron/44.9.1 Safari/537.36",
    ),
  ).toBe(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36",
  )
  expect(
    browserUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) opencode-beta/2.3.0-beta.1 Chrome/140.0.0.0 Electron/44.9.1 Safari/537.36",
    ),
  ).toBe(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  )
})
