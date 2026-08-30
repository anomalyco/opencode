import { expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { entrySplash, exitSplash } from "../../src/mini/splash"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import { stringWidth } from "../../src/util/string-width"

const version = "local"

test.each([false, true])("exit metadata stays readable without dim attributes (mono=%s)", async (mono) => {
  const app = await createTestRenderer({ width: 80, height: 8 })
  try {
    const snapshot = exitSplash({
      title: "Review mini layout",
      session_id: "ses_mini",
      theme: RUN_THEME_FALLBACK.splash,
      mono,
    })({ width: 80, widthMethod: app.renderer.widthMethod, tailColumn: 0, renderContext: app.renderer })
    app.renderer.root.add(snapshot.root)
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("opencode mini -s ses_mini")
    expect(
      app
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .every((span) => !(span.attributes & TextAttributes.DIM)),
    ).toBe(true)
    expect(snapshot.startOnNewLine).toBe(true)
    expect(snapshot.trailingNewline).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  { width: 120, detail: "~/project", mono: false },
  { width: 60, detail: "/home/simon/.cache/tmp/opencode/mini/header/samples/project", mono: false },
  { width: 44, detail: "/home/研究/長いディレクトリ/画面/設定/mini/project", mono: false },
  { width: 120, detail: "~/project", mono: true },
  { width: 44, detail: "/home/simon/.cache/tmp/opencode/mini/header/samples/project", mono: true },
])("entry header fits one line without clipping the path (%o)", async (input) => {
  const app = await createTestRenderer({ width: input.width, height: 5 })
  const theme = { ...RUN_THEME_FALLBACK.splash, left: RGBA.fromHex("#666666"), right: RGBA.fromHex("#cccccc") }
  try {
    const snapshot = entrySplash({
      version,
      detail: input.detail,
      theme,
      mono: input.mono,
    })({ width: input.width, widthMethod: app.renderer.widthMethod, tailColumn: 0, renderContext: app.renderer })
    app.renderer.root.add(snapshot.root)
    await app.renderOnce()

    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
    const prefix = `${input.mono ? "#" : "▪"} oc mini v${version} ${input.mono ? "-" : "·"} `
    expect(rows[0]).toBe("")
    expect(rows[1].startsWith(prefix)).toBe(true)
    expect(rows[1].endsWith("/project")).toBe(true)
    expect(stringWidth(rows[1])).toBeLessThanOrEqual(input.width)
    expect(rows.slice(2).every((row) => row === "")).toBe(true)
    if (stringWidth(prefix + input.detail) <= input.width) {
      expect(rows[1]).toBe(prefix + input.detail)
    } else {
      expect(rows[1]).toContain(input.mono ? "..." : "…")
      expect(rows[1]).toContain("/home/")
    }
    if (input.mono) expect(rows[1]).not.toMatch(/[^\x20-\x7e]/)

    const spans = app.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.find((span) => span.text.includes("oc mini"))?.fg.toInts()).toEqual(theme.right.toInts())
    expect(spans.find((span) => span.text.includes(`v${version}`))?.fg.toInts()).toEqual(theme.left.toInts())
    expect(spans.every((span) => !(span.attributes & (TextAttributes.BOLD | TextAttributes.DIM)))).toBe(true)
    expect(snapshot.height).toBe(2)
    expect(snapshot.rowColumns).toBe(input.width)
    expect(snapshot.startOnNewLine).toBe(true)
    expect(snapshot.trailingNewline).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test.each(["local", "1.18.4-preview.abcd123"])("entry header renders the injected version %s", async (version) => {
  const app = await createTestRenderer({
    width: 80,
    height: 8,
    screenMode: "split-footer",
    footerHeight: 4,
    externalOutputMode: "capture-stdout",
  })
  try {
    app.renderer.writeToScrollback(
      entrySplash({
        version,
        detail: "~/project",
        theme: RUN_THEME_FALLBACK.splash,
      }),
    )
    await app.renderOnce()

    expect(app.externalOutput.take()).toMatchObject([
      {
        width: 80,
        height: 2,
        rowColumns: 80,
        rows: ["", `▪ oc mini v${version} · ~/project`],
        startOnNewLine: true,
        trailingNewline: false,
      },
    ])
  } finally {
    app.renderer.destroy()
  }
})
