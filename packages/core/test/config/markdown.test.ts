import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

const invalidYaml = `---
description: Use when the user needs to crawl pages. Keywords: crawl, scrape
---
body`

describe("ConfigMarkdown.parse", () => {
  test("recovers unquoted-colon frontmatter via the sanitize fallback", () => {
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
    expect(parsed.content.trim()).toBe("body")
  })

  test("preserves inline flow mappings and sequences when recovering unquoted descriptions", () => {
    const parsed = ConfigMarkdown.parse(`---
description: Review changes. Keywords: review, audit
model: { providerID: example, model: chat, variant: high }
permissions: [{ action: edit, resource: "*", effect: deny }]
---
Review carefully.`)

    expect(parsed.data.description).toBe("Review changes. Keywords: review, audit")
    expect(parsed.data.model).toEqual({ providerID: "example", model: "chat", variant: "high" })
    expect(parsed.data.permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
    expect(parsed.content.trim()).toBe("Review carefully.")
  })

  test.each([
    [
      "quoted description",
      'description: "Review changes. Keywords: review, audit"',
      "Review changes. Keywords: review, audit",
    ],
    ["plain description", "description: Review changes", "Review changes"],
  ])("keeps %s frontmatter values unchanged", (_name, description, expectedDescription) => {
    const parsed = ConfigMarkdown.parse(
      `---\n${description}\nmodel: { providerID: example, model: chat, variant: high }\n---\nReview carefully.`,
    )
    expect(parsed.data.model).toEqual({ providerID: "example", model: "chat", variant: "high" })
    expect(parsed.content.trim()).toBe("Review carefully.")
    expect(parsed.data.description).toBe(expectedDescription)
  })

  test("preserves commented flow values with nested quoted colons during fallback", () => {
    const parsed = ConfigMarkdown.parse(`---
description: Review changes. Keywords: review, audit
model: { providerID: example, model: "chat:review", variant: high } # model
permissions: [{ action: edit, resource: "scope: nested", effect: deny }] # permission
---
Review carefully.`)

    expect(parsed.data.description).toBe("Review changes. Keywords: review, audit")
    expect(parsed.data.model).toEqual({ providerID: "example", model: "chat:review", variant: "high" })
    expect(parsed.data.permissions).toEqual([{ action: "edit", resource: "scope: nested", effect: "deny" }])
    expect(parsed.content.trim()).toBe("Review carefully.")
  })

  test.each([
    ['"request"', "request"],
    ["request-headers", "request-headers"],
  ])("keeps the flow probe separate from a %s sibling field", (key, name) => {
    const parsed = ConfigMarkdown.parse(`---
mode: &agent_mode all
description: Review changes. Keywords: review, audit
model: { providerID: example, model: chat, variant: high }
${key}: { headers: { x-mode: *agent_mode } }
---
body`)

    expect(parsed.data.model).toEqual({ providerID: "example", model: "chat", variant: "high" })
    expect(parsed.data[name]).toEqual({ headers: { "x-mode": "all" } })
    expect(parsed.data.description).toBe("Review changes. Keywords: review, audit")
    expect(parsed.content.trim()).toBe("body")
  })

  test("recovers a frontmatter value that starts with a bracketed tag", () => {
    const parsed = ConfigMarkdown.parse("---\ndescription: [Team] Does a thing\ntools: [read, edit]\n---\nbody")
    expect(parsed.data.description).toBe("[Team] Does a thing")
    expect(parsed.data.tools).toEqual(["read", "edit"])
  })

  test("recovers bracketed prose with an indented continuation", () => {
    const parsed = ConfigMarkdown.parse(`---
description: [Team] # review notes
  Checks changes carefully.
---
body`)

    expect(parsed.data.description).toBe("[Team] # review notes\nChecks changes carefully.")
    expect(parsed.content.trim()).toBe("body")
  })

  test("recovers the same content again after a previous failed parse", () => {
    // gray-matter caches by content before parsing; a poisoned entry used to
    // make every later parse of the same text return silently without data.
    expect(() => ConfigMarkdown.parse("---\ndescription: [unclosed\n---\nbody")).toThrow()
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
  })

  test("keeps throwing for the same unparseable content on every call", () => {
    const input = "---\ndescription: [unclosed\n---\nbody"
    expect(() => ConfigMarkdown.parse(input)).toThrow()
    expect(() => ConfigMarkdown.parse(input)).toThrow()
  })

  test("parses plain content without frontmatter", () => {
    const parsed = ConfigMarkdown.parse("just body")
    expect(parsed.content).toBe("just body")
    expect(parsed.data).toEqual({})
  })
})
