import { describe, expect, test } from "bun:test"
import { lint, rules } from "./design-lint"

const css = (text: string, path = "src/components/card.css") => lint({ path, text })

const tsx = (text: string, path = "src/components/card.tsx") => lint({ path, text })

const ids = (findings: ReturnType<typeof lint>) => findings.map((finding) => finding.rule)

describe("rules", () => {
  test("every rule names a skill", () => {
    expect(rules.map((rule) => rule.id)).toEqual([
      "design/no-raw-color",
      "design/no-legacy-token",
      "design/no-solid-line-height",
      "design/dark-mode-selector",
      "design/no-physical-direction",
    ])
    expect(rules.every((rule) => rule.skill.startsWith("opencode-ui-"))).toBe(true)
  })

  test("ignores other file types", () => {
    expect(lint({ path: "README.md", text: "color: #fff;" })).toEqual([])
  })
})

describe("design/no-raw-color", () => {
  test("flags literal colors in CSS values", () => {
    const findings = css(
      [
        ".a {",
        "  color: #fff;",
        "  background: rgba(0, 0, 0, 0.5);",
        "  border-color: oklch(0.7 0.1 200);",
        "  --local: #11223344;",
        "}",
      ].join("\n"),
    )

    expect(ids(findings)).toEqual(Array(4).fill("design/no-raw-color"))
    expect(findings[0]).toMatchObject({ line: 2, column: 10, excerpt: "color: #fff;" })
  })

  test("allows tokens, keywords, selectors, urls and strings", () => {
    const findings = css(
      [
        "#main .a:hover {",
        "  color: var(--v2-text-text-base);",
        "  background: transparent;",
        "  border-color: currentColor;",
        "  fill: inherit;",
        "  mask: url(#mask);",
        '  content: "#fff";',
        "  background: rgb(var(--v2-grey-50));",
        "  mask-image: linear-gradient(to right, #000 80%, transparent);",
        "  color: color-mix(in srgb, var(--v2-text-text-base) 50%, transparent);",
        "}",
      ].join("\n"),
    )

    expect(findings).toEqual([])
  })

  test("flags Tailwind arbitrary values and style colors in TSX", () => {
    const findings = tsx(
      [
        '<div class="bg-[#fff] p-2" />',
        "<div class='[color:rgb(0_0_0)]' />",
        '<div style={{ color: "#ff0000", width: "10px" }} />',
        '<div style="background-color: #000" />',
      ].join("\n"),
    )

    expect(ids(findings)).toEqual(Array(4).fill("design/no-raw-color"))
  })

  test("ignores hashes that are not colors in TSX", () => {
    expect(
      tsx('<a href="#add" id="fff" />\nconst accent = "#ff0000"\n<div class="bg-v2-background-bg-base" />'),
    ).toEqual([])
  })

  test("exempts token and theme sources", () => {
    expect(css(":root { --gray-1: #fff; }", "packages/ui/src/styles/colors.css")).toEqual([])
    expect(css(":root { --v2-x: #fff; }", "packages/ui/src/styles/tokens/colors.css")).toEqual([])
    expect(tsx('const theme = { background: "#fff" }', "packages/ui/src/theme/resolve.ts")).toEqual([])
  })
})

describe("design/no-legacy-token", () => {
  test("flags legacy variables in CSS and TSX", () => {
    expect(ids(css(".a { color: var(--text-strong); background: var(--surface-base); }"))).toEqual([
      "design/no-legacy-token",
      "design/no-legacy-token",
    ])
    expect(ids(tsx('<div style={{ color: "var(--icon-base)" }} />'))).toEqual(["design/no-legacy-token"])
  })

  test("flags legacy Tailwind color classes", () => {
    expect(ids(tsx('<div class="bg-surface-base text-text-strong hover:border-border-weak-base/50" />'))).toEqual(
      Array(3).fill("design/no-legacy-token"),
    )
  })

  test("allows v2 tokens and shared scales", () => {
    expect(
      css(
        ".a { color: var(--v2-text-text-base); font-size: var(--font-size-base); border-radius: var(--radius-md); box-shadow: var(--shadow-xs); line-height: var(--line-height-large); }",
      ),
    ).toEqual([])
    expect(tsx('<div class="bg-v2-background-bg-base text-base text-sm shadow-xs rounded-md" />')).toEqual([])
  })

  test("exempts legacy sources", () => {
    expect(css(":root { --a: var(--surface-base); }", "packages/ui/src/styles/theme.css")).toEqual([])
  })
})

describe("design/no-solid-line-height", () => {
  test("flags solid line heights", () => {
    expect(
      ids(
        css(
          ".a { line-height: 1; } .b { line-height: 100%; } .c { line-height: 1.0 !important; } .d { font: 12px/1 sans-serif; }",
        ),
      ),
    ).toEqual(Array(4).fill("design/no-solid-line-height"))
    expect(ids(tsx('<div class="leading-none md:leading-[1]" />'))).toEqual(
      Array(2).fill("design/no-solid-line-height"),
    )
  })

  test("allows other line heights", () => {
    expect(
      css(".a { line-height: 1.5; } .b { line-height: var(--line-height-tight); } .c { line-height: 16px; }"),
    ).toEqual([])
    expect(tsx('<div class="leading-text-tight leading-5" />')).toEqual([])
  })
})

describe("design/dark-mode-selector", () => {
  test("flags dark selectors in CSS", () => {
    expect(
      ids(
        css(
          [
            ".dark .a { color: var(--v2-text-text-base); }",
            '[data-theme="dark"] .a { color: var(--v2-text-text-base); }',
            "@media (prefers-color-scheme: dark) { .a { color: var(--v2-text-text-base); } }",
          ].join("\n"),
        ),
      ),
    ).toEqual(Array(3).fill("design/dark-mode-selector"))
  })

  test("allows data-color-scheme and similar class names", () => {
    expect(css('[data-color-scheme="dark"] .a, .dark-mode, .darker { color: var(--v2-text-text-base); }')).toEqual([])
  })

  test("flags dark variants and data-theme checks in TSX", () => {
    expect(
      ids(
        tsx(
          [
            '<div class="dark:bg-v2-background-bg-base" />',
            "document.querySelector(\"[data-theme='dark']\")",
            'if (document.documentElement.dataset.theme === "dark") {}',
          ].join("\n"),
        ),
      ),
    ).toEqual(Array(3).fill("design/dark-mode-selector"))
  })

  test("allows color scheme checks in TSX", () => {
    expect(
      tsx('const mode = document.documentElement.dataset.colorScheme === "dark"\nconst label = "dark: on"'),
    ).toEqual([])
  })

  test("exempts theme sources", () => {
    expect(
      css("@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }", "src/styles/theme.css"),
    ).toEqual([])
  })
})

describe("design/no-physical-direction", () => {
  test("flags physical CSS", () => {
    const findings = css(
      [
        ".a {",
        "  margin-left: 4px;",
        "  padding-right: 4px;",
        "  border-left-color: var(--v2-border-border-base);",
        "  border-top-left-radius: 2px;",
        "  left: 0;",
        "  text-align: right;",
        "  float: left;",
        "}",
      ].join("\n"),
    )

    expect(ids(findings)).toEqual(Array(7).fill("design/no-physical-direction"))
    expect(findings[3]!.message).toContain("border-start-start-radius")
  })

  test("allows logical CSS", () => {
    expect(
      css(
        ".a { margin-inline-start: 4px; inset-inline-end: 0; text-align: start; margin: 0 4px; top: 0; transform-origin: left; }",
      ),
    ).toEqual([])
  })

  test("flags physical Tailwind classes", () => {
    const findings = tsx(
      '<div class="ml-2 -mr-1 md:pl-4 pr-px left-0 hover:right-1/2 text-left rounded-l rounded-tr-md border-l border-r-2 float-right [margin-left:4px]" />',
    )

    expect(ids(findings)).toEqual(Array(13).fill("design/no-physical-direction"))
  })

  test("allows logical Tailwind classes and plain words", () => {
    expect(
      tsx(
        '<div class="ms-2 pe-4 start-0 text-start rounded-s border-e border-red-500" data-slot="right-panel" placement="left" />',
      ),
    ).toEqual([])
  })
})

describe("suppression", () => {
  test("suppresses with a reason on the same line or the line above", () => {
    expect(
      css(".a { margin-left: 4px; /* design-lint-allow design/no-physical-direction: icon optical offset */ }"),
    ).toEqual([])
    expect(
      tsx(
        [
          "// design-lint-allow design/no-raw-color: brand color from the marketing spec",
          '<div class="bg-[#fff]" />',
        ].join("\n"),
      ),
    ).toEqual([])
  })

  test("does not suppress without a reason or for another rule", () => {
    expect(ids(css(".a { margin-left: 4px; /* design-lint-allow design/no-physical-direction */ }"))).toEqual([
      "design/no-physical-direction",
    ])
    expect(ids(css(".a { margin-left: 4px; /* design-lint-allow design/no-physical-direction: */ }"))).toEqual([
      "design/no-physical-direction",
    ])
    expect(ids(css(".a { margin-left: 4px; /* design-lint-allow design/no-raw-color: reason */ }"))).toEqual([
      "design/no-physical-direction",
    ])
  })
})
