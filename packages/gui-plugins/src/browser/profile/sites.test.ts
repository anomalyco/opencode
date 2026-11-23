import { expect, test } from "bun:test"
import { cookieSite, groupSites, siteFilter } from "./sites"

test("names each cookie host by the site it belongs to", () => {
  const table: [string, string | undefined][] = [
    // Domain and host-only cookies of one site, and its subdomains, are one site.
    [".github.com", "github.com"],
    ["github.com", "github.com"],
    ["gist.github.com", "github.com"],
    [".api.eu.example.com", "example.com"],
    // Multi-part public suffixes.
    ["shop.example.co.uk", "example.co.uk"],
    [".bbc.co.uk", "bbc.co.uk"],
    ["a.b.example.com.au", "example.com.au"],
    // Private suffixes separate their tenants, as Chromium scopes cookies by them.
    ["alice.github.io", "alice.github.io"],
    ["docs.alice.github.io", "alice.github.io"],
    ["bob.github.io", "bob.github.io"],
    // A bare suffix, localhost and a single-label intranet host are their own site.
    ["co.uk", "co.uk"],
    ["localhost", "localhost"],
    ["app.localhost", "app.localhost"],
    ["api.app.localhost", "app.localhost"],
    ["intranet", "intranet"],
    ["wiki.corp", "wiki.corp"],
    // IP addresses, IPv6 with or without brackets.
    ["127.0.0.1", "127.0.0.1"],
    ["192.168.1.10", "192.168.1.10"],
    ["::1", "[::1]"],
    ["[2001:db8::1]", "[2001:db8::1]"],
    // Names are ASCII; a Unicode name from a cookie file becomes punycode, and case does not matter.
    ["xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
    ["shop.münchen.de", "xn--mnchen-3ya.de"],
    ["WWW.Example.COM", "example.com"],
    // Hosts that name no site.
    ["", undefined],
    [".", undefined],
    ["bad host", undefined],
  ]

  expect(table.map(([host]) => [host, cookieSite(host)])).toEqual(table)
})

test("lists one row per site with its cookies that would import, most recently used first", () => {
  const now = 2_000_000_000

  expect(
    groupSites(
      [
        { host: ".github.com", expires: undefined, used: 100 },
        { host: "github.com", expires: now + 60, used: 900 },
        { host: "gist.github.com", expires: now + 60, used: 50 },
        { host: "linear.app", expires: now + 60, used: 1000 },
        // An expired cookie would not import, and a site with only expired cookies is not listed.
        { host: "linear.app", expires: now - 1, used: 5000 },
        { host: "old.test", expires: now - 1, used: 4000 },
        // Sites never used, or used at the same time, follow by name.
        { host: "b.test", expires: undefined, used: 0 },
        { host: "a.test", expires: undefined, used: 0 },
        { host: "", expires: undefined, used: 9999 },
        // A site longer than any host a browser sends cookies to leaves the list, not the whole list.
        { host: `${"a".repeat(250)}.${"b".repeat(10)}.test`, expires: undefined, used: 9999 },
      ],
      now,
    ),
  ).toEqual([
    { site: "linear.app", cookies: 1 },
    { site: "github.com", cookies: 3 },
    { site: "a.test", cookies: 1 },
    { site: "b.test", cookies: 1 },
  ])
})

test("keeps the cookies of the chosen sites only, domain and host-only alike", () => {
  const keep = siteFilter(["github.com", "alice.github.io", "[::1]"])

  expect(
    [
      ".github.com",
      "github.com",
      "api.github.com",
      "github.com.evil.test",
      "notgithub.com",
      "alice.github.io",
      "bob.github.io",
      "::1",
      "example.com",
      "",
    ].filter(keep),
  ).toEqual([".github.com", "github.com", "api.github.com", "alice.github.io", "::1"])
})

test("groups the 5,000 sites of a large profile", () => {
  const cookies = Array.from({ length: 5_000 }, (_, site) =>
    Array.from({ length: 8 }, (_, cookie) => ({
      host: cookie % 2 ? `.site${site}.co.uk` : `app${cookie}.site${site}.co.uk`,
      expires: undefined,
      used: site,
    })),
  ).flat()

  const sites = groupSites(cookies, 0)

  expect(sites).toHaveLength(5_000)
  expect(sites[0]).toEqual({ site: "site4999.co.uk", cookies: 8 })
})
