import { describe, expect, test } from "bun:test"
import { footerStatuslinePolicy, type FooterStatuslineGroup } from "../../src/mini/footer.width"
import { stringWidth } from "../../src/util/string-width"

const screenshot = {
  work: [],
  model: { name: "GPT-5.6 Sol (50% Off)", variant: "max" },
  agent: "Build",
  context: { compact: "1% ctx", full: "14.1K (1%)" },
  cost: "$0.04",
  provider: "Anomaly / OpenCode",
  menu: { key: "ctrl+p", label: "menu" },
} satisfies Omit<Parameters<typeof footerStatuslinePolicy>[0], "width">

describe("run footer width", () => {
  test.each([false, true])("progressive layouts fit and preserve information at every width (mono=%s)", (mono) => {
    const fixtures: Array<Omit<Parameters<typeof footerStatuslinePolicy>[0], "width">> = [
      { work: [] },
      screenshot,
      { ...screenshot, model: { name: "GPT-5", variant: "xhigh" } },
      { ...screenshot, model: { name: "a model name with a very long and informative suffix".repeat(3) } },
      {
        ...screenshot,
        model: { name: "\u6a21\u578b\ud83d\ude80e\u0301\u5f00\u53d1 Model".repeat(3), variant: "\u9ad8\u7ea7" },
      },
      { ...screenshot, model: { name: "GPT-5", variant: "an-unusually-long-but-complete-variant" } },
      { ...screenshot, status: { text: "esc stop", expanded: "esc interrupt" }, spinner: mono ? "*" : "\u25aa" },
      {
        ...screenshot,
        status: { text: "ctrl+shift+alt+i stop", expanded: "ctrl+shift+alt+i interrupt" },
        work: [
          { id: "queued", key: "ctrl+x q", label: "12 queued" },
          { id: "subagents", key: mono ? "down" : "\u2193", label: "2 sub", expanded: "2 subagents" },
          { id: "background", key: "ctrl+b", label: "bg", expanded: "background" },
        ],
      },
      { work: [], status: { text: "Shell" }, escape: { key: "esc", label: "normal" }, context: screenshot.context },
    ]
    for (const fixture of fixtures) {
      let previous: FooterStatuslineGroup["id"][] = []
      for (let width = 0; width <= 280; width++) {
        const layout = footerStatuslinePolicy({ ...fixture, mono, width })
        const ids = layout.groups.map((group) => group.id)
        if (fixture.spinner) {
          expect(ids[0]).toBe("spinner")
          expect(layout.text).toStartWith(`${fixture.spinner} `)
          if (width >= stringWidth(`${fixture.spinner} ${fixture.status!.text}`)) {
            expect(stringWidth(layout.text)).toBeLessThanOrEqual(width)
          }
        }
        if (stringWidth(layout.text) > width) {
          expect(ids.every((id) => id === "spinner" || id === "status" || id === "escape")).toBe(true)
        }
        for (const id of previous) expect(ids).toContain(id)
        expect(new Set(ids).size).toBe(ids.length)
        if (ids.includes("menu")) expect(ids.at(-1)).toBe("menu")
        const identity = layout.groups.find((group) => group.id === "model")
        if (identity && fixture.model?.variant) {
          expect(identity.parts.map((part) => part.text).join("")).toEndWith(` [${fixture.model.variant}]`)
        }
        expect(layout.text).not.toContain("\ufffd")
        previous = ids
      }
    }
  })

  test("identity admission cannot separate the selected variant from its model", () => {
    const input = { work: [], model: { name: "GPT-5", variant: "max" } }
    expect(footerStatuslinePolicy({ ...input, width: 10 }).groups).toEqual([])
    expect(footerStatuslinePolicy({ ...input, width: 11 }).text).toBe("GPT-5 [max]")
  })

  test("allocation priority is separate from placement", () => {
    expect(footerStatuslinePolicy({ ...screenshot, width: 15 }).groups.map((group) => group.id)).toEqual(["model"])
    expect(footerStatuslinePolicy({ ...screenshot, width: 60 }).groups.map((group) => group.id)).toEqual([
      "agent",
      "model",
      "context",
      "cost",
    ])
    const full = footerStatuslinePolicy({ ...screenshot, width: 112 })
    expect(full.text).toBe(
      "Build \u00b7 GPT-5.6 Sol (50% Off) [max] \u00b7 14.1K (1%) \u00b7 Anomaly / OpenCode \u00b7 $0.04 \u00b7 ctrl+p menu",
    )
  })

  test("a non-fitting high-priority stage does not backfill with shorter facts", () => {
    const input = {
      ...screenshot,
      work: [{ id: "queued" as const, key: "ctrl+shift+alt+q", label: "12 queued" }],
    }
    expect(footerStatuslinePolicy({ ...input, width: 24 }).groups).toEqual([])
    expect(footerStatuslinePolicy({ ...input, width: 26 }).groups.map((group) => group.id)).toEqual(["queued"])
  })

  test("context and cost are distinct additions", () => {
    const input = { work: [], context: screenshot.context, cost: screenshot.cost }
    expect(footerStatuslinePolicy({ ...input, width: 6 }).text).toBe("1% ctx")
    expect(footerStatuslinePolicy({ ...input, width: 10 }).text).toBe("14.1K (1%)")
    expect(footerStatuslinePolicy({ ...input, width: 18 }).text).toBe("14.1K (1%) \u00b7 $0.04")
  })

  test("stop-label enhancement cannot remove identity at the former 56-column breakpoint", () => {
    const input = { ...screenshot, status: { text: "esc stop", expanded: "esc interrupt" } }
    for (const width of [55, 56, 57, 79, 80, 81]) {
      const layout = footerStatuslinePolicy({ ...input, width })
      expect(layout.text).toContain("GPT-5.6 Sol (50% Off) [max]")
      expect(layout.text).toStartWith("esc stop")
    }
    expect(footerStatuslinePolicy({ ...input, width: 160 }).text).toStartWith("esc interrupt")
  })

  test("required controls use an explicit wrapping fallback without optional groups", () => {
    expect(footerStatuslinePolicy({ ...screenshot, width: 16, status: { text: "ctrl+shift+alt+x exit" } }).text).toBe(
      "ctrl+shift+alt+x exit",
    )
    expect(
      footerStatuslinePolicy({ ...screenshot, width: 80, status: { text: "Please confirm\nExit now?" } }).text,
    ).toBe("Please confirm\nExit now?")
  })
})
