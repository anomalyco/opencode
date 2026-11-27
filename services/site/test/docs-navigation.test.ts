import { describe, expect, test } from "bun:test"
import { docsSectionTitles, type DocsSection, type DocsNavLabel } from "../src/docs/lib/navigation"

describe("localized docs navigation", () => {
  const section: DocsSection = {
    key: "docs",
    title: "Docs",
    titleKey: "nav.docs",
    landingSlug: "index",
    groups: [
      {
        title: "Configure",
        titleKey: "docs.nav.configure",
        items: [
          { title: "Intro", slug: "index" },
          { title: "Instructions", slug: "instructions" },
          { title: "Go", slug: "console/go", href: "/docs/console/go/" },
        ],
      },
    ],
  }
  const labels: Partial<Record<DocsNavLabel, string>> = {
    "nav.docs": "文档",
    "docs.nav.configure": "配置",
  }
  const englishLabels: Partial<Record<DocsNavLabel, string>> = {
    "nav.docs": "Docs",
    "docs.nav.configure": "Configure",
  }
  const localized = docsSectionTitles(section, new Map([["instructions", "指令"]]), (key) => labels[key] ?? key)

  test("section and group labels come from the dictionary", () => {
    expect(localized.title).toBe("文档")
    expect(localized.groups[0].title).toBe("配置")
  })

  test("translated pages take their frontmatter title; others keep the English navigation title", () => {
    expect(localized.groups[0].items.map((item) => item.title)).toEqual(["Intro", "指令", "Go"])
  })

  test("a link to another set keeps its own title", () => {
    expect(localized.groups[0].items[2]).toEqual({ title: "Go", slug: "console/go", href: "/docs/console/go/" })
  })

  test("English navigation keeps its titles and labels", () => {
    const english = docsSectionTitles(section, new Map(), (key) => englishLabels[key] ?? key)
    expect(english.title).toBe("Docs")
    expect(english.groups[0].title).toBe("Configure")
    expect(english.groups[0].items.map((item) => item.title)).toEqual(["Intro", "Instructions", "Go"])
  })
})
