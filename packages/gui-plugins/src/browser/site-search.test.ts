import { expect, test } from "bun:test"
import { matchSites } from "./site-search"

const sites = ["github.com", "linear.app", "xn--mnchen-3ya.de", "alice.github.io", "127.0.0.1", "[::1]"].map((site) => ({
  site,
  cookies: 1,
}))

const search = (query: string) => matchSites(sites, query).map((item) => item.site)

test("finds sites by a part of their name, a pasted address or a subdomain", () => {
  expect(search("")).toEqual(sites.map((item) => item.site))
  expect(search("  GitHub ")).toEqual(["github.com", "alice.github.io"])
  expect(search("lin")).toEqual(["linear.app"])
  expect(search("https://app.linear.app/team/issues")).toEqual(["linear.app"])
  expect(search("gist.github.com")).toEqual(["github.com"])
  expect(search("münchen")).toEqual(["xn--mnchen-3ya.de"])
  expect(search("127.0")).toEqual(["127.0.0.1"])
  expect(search("::1")).toEqual(["[::1]"])
  expect(search("gitlab")).toEqual([])
  // Only a pasted address's host matches a site it belongs to, never text elsewhere in the address.
  expect(search("https://evil.net/?next=.github.com")).toEqual([])
  expect(search("javascript:alert(1)//.github.com")).toEqual([])
})
