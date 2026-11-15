import { describe, expect, test } from "bun:test"

// Served at /.well-known/security.txt by src/middleware.ts.
const text = await Bun.file(new URL("../src/lib/legal/security.txt", import.meta.url)).text()
const fields = text
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()] as const)
const values = (name: string) => fields.filter((field) => field[0] === name).map((field) => field[1])

describe("security.txt", () => {
  test("has the RFC 9116 fields", () => {
    expect(fields.every((field) => /^[A-Za-z-]+$/.test(field[0]) && field[1])).toBe(true)
    expect(values("Contact")).toEqual([
      "https://github.com/anomalyco/opencode/security/advisories/new",
      "mailto:security@anoma.ly",
    ])
    expect(values("Expires")).toHaveLength(1)
    expect(values("Canonical")).toEqual(["https://opencode.ai/.well-known/security.txt"])
    // The policy is SECURITY.md on GitHub (the security page draft is kept outside the repository).
    expect(values("Policy")).toEqual(["https://github.com/anomalyco/opencode/security/policy"])
  })

  // Field lines are bare "Name: value" with no trailing comment; anything else is a whole-line
  // comment or blank. Contact at least once, Expires exactly once, Preferred-Languages at most once.
  test("follows the RFC 9116 grammar", () => {
    const lines = text.replace(/\n$/, "").split("\n")
    expect(lines.filter((line) => line && !line.startsWith("#") && !/^[A-Za-z0-9-]+: [^#\s][^#]*$/.test(line))).toEqual(
      [],
    )
    expect(values("Contact").length).toBeGreaterThan(0)
    expect(values("Expires")).toHaveLength(1)
    expect(values("Preferred-Languages").length).toBeLessThanOrEqual(1)
  })

  // The comment tables restate the fields, so they must change with them.
  test("its tables match the fields", () => {
    const comments = text.split("\n").filter((line) => line.startsWith("#"))
    const emails = comments.flatMap((line) => line.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
    expect(emails).toEqual(
      values("Contact")
        .filter((contact) => contact.startsWith("mailto:"))
        .map((contact) => contact.slice(7)),
    )
    expect(comments.some((line) => line.includes("GitHub advisory"))).toBe(true)
    const date = new Date(values("Expires")[0]).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    expect(comments.some((line) => /\| Expires\s+\|/.test(line) && line.includes(date))).toBe(true)
  })

  // RFC 9116 asks for Expires less than a year ahead. This fails 30 days before it lapses, so renew it then.
  test("does not expire within 30 days", () => {
    const expires = new Date(values("Expires")[0])
    expect(values("Expires")[0]).toBe(expires.toISOString())
    expect(expires.getTime() - Date.now()).toBeGreaterThan(30 * 24 * 60 * 60 * 1000)
    expect(expires.getTime() - Date.now()).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000)
  })
})
