import { describe, expect, test } from "bun:test"
import { createUiDocument, interpretUiPrompt, parseUiDocument } from "./model"
import { renderUiDocument } from "./render"

describe("ui design prompts", () => {
  test("creates a template from natural language", () => {
    const document = createUiDocument("landing")
    const result = interpretUiPrompt(document, "create a pricing page")

    expect(result.ok).toBe(true)
    expect(result.document.template).toBe("pricing")
    expect(result.document.sections.some((section) => section.kind === "pricing")).toBe(true)
  })

  test("adds a section before the footer", () => {
    const document = createUiDocument("landing")
    const result = interpretUiPrompt(document, "add a contact form section")
    const kinds = result.document.sections.map((section) => section.kind)

    expect(result.ok).toBe(true)
    expect(kinds.filter((kind) => kind === "form")).toHaveLength(1)
    expect(kinds.at(-1)).toBe("footer")
  })

  test("changes theme values", () => {
    const document = createUiDocument("landing")
    const dark = interpretUiPrompt(document, "make it dark")
    const accent = interpretUiPrompt(dark.document, "make the accent purple")
    const rounded = interpretUiPrompt(accent.document, "make the corners rounded")

    expect(dark.document.theme.mode).toBe("dark")
    expect(accent.document.theme.accent).toBe("#9a6be8")
    expect(rounded.document.theme.radius).toBeGreaterThan(14)
  })

  test("renames the page", () => {
    const document = createUiDocument("landing")
    const result = interpretUiPrompt(document, "rename the page to Atlas")

    expect(result.ok).toBe(true)
    expect(result.document.title).toBe("Atlas")
    expect(result.document.sections.find((section) => section.kind === "hero")?.title).toBe("Atlas")
  })

  test("round-trips a page and escapes preview content", () => {
    const document = createUiDocument("contact", "Fieldnote")
    const parsed = parseUiDocument(JSON.parse(JSON.stringify(document)))
    const html = renderUiDocument({ ...document, title: "<script>alert(1)</script>" })

    expect(parsed).toEqual(document)
    expect(parseUiDocument({ version: 1 })).toBeUndefined()
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })
})
