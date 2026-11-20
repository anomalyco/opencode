import { describe, expect, test } from "bun:test"
import { robotsTxt } from "../src/lib/robots-txt"

// Served at /robots.txt by src/middleware.ts.
const text = await robotsTxt()
const lines = text.replace(/\n$/, "").split("\n")
const directives = lines.filter((line) => !line.startsWith("#")).map((line) => line.replace(/\s*#.*$/, ""))
const encoder = new TextEncoder()

describe("robots.txt", () => {
  test("has exactly the rules, in one group, then the sitemap", () => {
    expect(directives).toEqual([
      "User-agent: *",
      "Allow: /",
      "Disallow: /s/",
      "Disallow: /share/",
      "Sitemap: https://opencode.ai/sitemap.xml",
    ])
    const group = lines.slice(
      lines.findIndex((line) => line.startsWith("User-agent")),
      lines.findIndex((line) => line.startsWith("Disallow: /share/")) + 1,
    )
    expect(group.every((line) => line.trim())).toBe(true)
    expect(lines.find((line) => line.startsWith("Sitemap"))).toBe("Sitemap: https://opencode.ai/sitemap.xml")
  })

  test("decorates only in comments, within 80 columns", () => {
    expect(
      lines.filter((line) => !line.startsWith("#") && !/^(User-agent|Allow|Disallow|Sitemap): /.test(line)),
    ).toEqual([])
    expect(lines.filter((line) => [...line].length > 80)).toEqual([])
    expect(lines.filter((line) => /\s$/.test(line))).toEqual([])
  })

  test("its byte offsets and size are true", () => {
    lines.reduce((offset, line) => {
      const gutter = line.match(/^#([0-9a-f]{4}) /)?.[1]
      if (gutter) expect(parseInt(gutter, 16)).toBe(offset)
      return offset + encoder.encode(line).length + 1
    }, 0)
    expect(text).toContain(`EOF · ${String(encoder.encode(text).length).padStart(6, "0")} BYTES`)
  })

  test("its checksums are the rule lines'", () => {
    const rules = directives.join("\n")
    const crc = (Bun.hash.crc32(rules) >>> 0).toString(16).padStart(8, "0")
    const sha = new Bun.CryptoHasher("sha256").update(rules).digest("hex")
    expect(text).toContain(`CRC32(rules, comments stripped) ${crc}`)
    expect(text).toContain(`CRC32(rules) ${crc}`)
    expect(text).toContain(`SHA-256(rules) ${sha.slice(0, 8)}`)
  })

  test("its matrix agrees with the rules", () => {
    const rows = lines.filter((line) => /^#[0-9a-f]{4} \| (Googlebot|GPTBot|ClaudeBot|\*) /.test(line))
    expect(rows).toHaveLength(4)
    rows.forEach((row) =>
      expect(
        row
          .split("|")
          .slice(2, 6)
          .map((cell) => cell.trim()),
      ).toEqual(["ALLOW", "ALLOW", "DENY", "DENY"]),
    )
  })
})
