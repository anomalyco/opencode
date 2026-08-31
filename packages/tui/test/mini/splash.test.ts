import { expect, test } from "bun:test"
import { RGBA, TextAttributes, type ScrollbackWriter } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { entrySplash, entrySplashLayout, exitSplash } from "../../src/mini/splash"
import { stringWidth } from "../../src/util/string-width"

const sizes = [16, 20, 24, 32, 40, 56, 80, 112].flatMap((width) => [false, true].map((mono) => ({ width, mono })))
const preview = "1.18.4-preview.abcd1234567890"
const marker = "▪"
const sessionID = "ses_fac1eb1b0ffeOk15TDttH2E1Oy"
const theme = {
  left: RGBA.fromIndex(8, "#666666"),
  right: RGBA.defaultForeground("#cccccc"),
  leftShadow: RGBA.defaultBackground("#111111"),
}

async function renderSplash(writer: ScrollbackWriter, width: number) {
  const app = await createTestRenderer({ width, height: 8, footerHeight: 4 })
  try {
    const snapshot = writer({
      width,
      widthMethod: app.renderer.widthMethod,
      tailColumn: 0,
      renderContext: app.renderer,
    })
    app.renderer.root.add(snapshot.root)
    await app.renderOnce()

    const frame = app
      .captureCharFrame()
      .split("\n")
      .map((row) => row.trimEnd())
    const rows = frame.slice(0, snapshot.height)
    const spans = app.captureSpans().lines.flatMap((line) => line.spans)
    expect(frame.slice(snapshot.height).every((row) => row === "")).toBe(true)
    expect(rows[0]).toBe("")
    expect(rows.every((row) => stringWidth(row) <= width)).toBe(true)
    expect(spans.every((span) => !(span.attributes & TextAttributes.DIM))).toBe(true)
    snapshot.root.destroyRecursively()

    app.renderer.screenMode = "split-footer"
    app.renderer.externalOutputMode = "capture-stdout"
    app.renderer.writeToScrollback(writer)
    await app.renderOnce()
    expect(app.externalOutput.take()).toMatchObject([
      {
        width,
        height: snapshot.height,
        rowColumns: width,
        rows,
        startOnNewLine: true,
        trailingNewline: false,
      },
    ])
    app.resize(width + 5, 8)
    await app.renderOnce()
    expect(app.externalOutput.take()).toEqual([])
    return { rows, spans }
  } finally {
    app.renderer.destroy()
  }
}

test.each(
  sizes.flatMap((size) =>
    ["local", preview].flatMap((version) =>
      [
        { detail: "~/src/wt/oc-mini-v2", leaf: "oc-mini-v2" },
        { detail: "/home/研究/長いディレクトリ/画面/設定/界e\u0301🙂", leaf: "界e\u0301🙂" },
        {
          detail: "~/src/project-directory-that-cannot-meaningfully-fit",
          leaf: "project-directory-that-cannot-meaningfully-fit",
        },
      ].map((path) => ({ ...size, ...path, version })),
    ),
  ),
)("entry discloses complete useful metadata (%o)", async (input) => {
  const result = await renderSplash(entrySplash({ ...input, theme }), input.width)
  const label = `${input.mono ? "[O]" : marker} oc mini`
  const separator = ` ${input.mono ? "-" : "·"} `
  const row = result.rows[1]
  const path = row.split(separator)[1]
  expect(result.rows).toHaveLength(2)
  expect(row.startsWith(label)).toBe(true)
  expect(["", ` v${input.version}`]).toContain(row.slice(label.length).split(separator)[0])
  if (stringWidth(label + separator + input.leaf) <= input.width) {
    expect(path).toBeDefined()
    expect(path!.endsWith(input.leaf)).toBe(true)
    const suffix = path!.replace(/^(?:…|\.\.\.)\//, "")
    expect(path === input.detail || input.detail.endsWith("/" + suffix)).toBe(true)
  } else {
    expect(path).toBeUndefined()
  }
  if (stringWidth(label + ` v${input.version}` + separator + input.detail) <= input.width) {
    expect(row).toBe(label + ` v${input.version}` + separator + input.detail)
  }
  if (input.mono) expect(row.replace(path ?? "", "")).not.toMatch(/[^\x20-\x7e]/)
  // Foreground roles are measured in terminal cells, not code-unit offsets.
  const labelStyle = result.spans.find((span) => span.fg.intent === "default")
  expect(labelStyle?.width).toBe(stringWidth(label))
  expect(labelStyle?.fg.toInts()).toEqual(theme.right.toInts())
  const metadata = result.spans.find((span) => span.fg.intent === "indexed")
  if (metadata) {
    expect(metadata.fg.intent).toBe("indexed")
    expect(metadata.fg.toInts()).toEqual(theme.left.toInts())
  }
  expect(result.spans.every((span) => !(span.attributes & TextAttributes.BOLD))).toBe(true)
})

test.each([
  { width: 20, mono: false, version: "local", expected: `${marker} oc mini` },
  { width: 22, mono: false, version: "local", expected: `${marker} oc mini · oc-mini-v2` },
  { width: 29, mono: false, version: "local", expected: `${marker} oc mini vlocal · oc-mini-v2` },
  { width: 31, mono: false, version: "local", expected: `${marker} oc mini vlocal · …/oc-mini-v2` },
  { width: 20, mono: false, version: preview, expected: `${marker} oc mini` },
  { width: 24, mono: false, version: preview, expected: `${marker} oc mini · oc-mini-v2` },
  { width: 24, mono: true, version: preview, expected: "[O] oc mini - oc-mini-v2" },
  { width: 32, mono: false, version: preview, expected: `${marker} oc mini · oc-mini-v2` },
])("entry progressively admits the basename, whole version, and parent directories (%o)", async (input) => {
  const result = await renderSplash(entrySplash({ ...input, detail: "~/src/wt/oc-mini-v2", theme }), input.width)
  expect(result.rows).toEqual(["", input.expected])
})

test.each([
  { width: 1, normal: "o", mono: "o" },
  { width: 2, normal: "oc", mono: "oc" },
  { width: 6, normal: "oc min", mono: "oc min" },
  { width: 7, normal: "oc mini", mono: "oc mini" },
  { width: 8, normal: "oc mini", mono: "oc mini" },
  { width: 9, normal: `${marker} oc mini`, mono: "oc mini" },
  { width: 10, normal: `${marker} oc mini`, mono: "oc mini" },
  { width: 11, normal: `${marker} oc mini`, mono: "[O] oc mini" },
])("entry drops the marker before clipping the app name (%o)", async (input) => {
  for (const mono of [false, true]) {
    const result = await renderSplash(entrySplash({ version: preview, detail: "~/project", theme, mono }), input.width)
    expect(result.rows).toEqual(["", mono ? input.mono : input.normal])
  }
})

test.each([undefined, "", "/", "~/", "C:\\projects\\mini\\"])(
  "entry handles absent and root locations (%s)",
  async (detail) => {
    const result = await renderSplash(entrySplash({ version: "local", detail, theme }), 80)
    expect(result.rows).toEqual(["", `${marker} oc mini vlocal` + (detail ? ` · ${detail}` : "")])
  },
)

test.each([false, true])("entry layout preserves admitted information at every width (mono=%s)", (mono) => {
  const suffix = (value: string) =>
    value
      .replace(/^(?:…|\.\.\.)[/\\]/, "")
      .replace(/[\\/]+/g, "/")
      .replace(/\/$/, "")
  for (const detail of [
    undefined,
    "",
    "/",
    "~/",
    "x/y",
    "a/b/c",
    "~/src/wt/oc-mini-v2",
    "C:\\projects\\mini\\",
    "/home/研究/画面/界e\u0301🙂",
    "~/project-directory-that-cannot-meaningfully-fit",
  ]) {
    for (const version of ["", "local", preview]) {
      let previous = entrySplashLayout({ width: 0, detail, version, mono })
      for (let width = 1; width <= 160; width++) {
        const layout = entrySplashLayout({ width, detail, version, mono })
        expect(stringWidth(layout.label + layout.metadata)).toBeLessThanOrEqual(width)
        expect(layout.version === "" || layout.version === version).toBe(true)
        if (previous.version) expect(layout.version).toBe(previous.version)
        if (previous.path) {
          expect(layout.path).not.toBe("")
          expect(suffix(layout.path)).toEndWith(suffix(previous.path))
        }
        if (layout.version && detail) expect(layout.path).not.toBe("")
        if (layout.path) expect(suffix(detail!)).toEndWith(suffix(layout.path))
        const marked = `${mono ? "[O]" : marker} oc mini`
        expect(layout.label).toBe(stringWidth(marked) <= width ? marked : "oc mini".slice(0, width))
        previous = layout
      }
      expect(previous.path).toBe(detail ?? "")
      expect(previous.version).toBe(version)
    }
  }
})

test.each([false, true])("entry skips abbreviated paths that are longer than the full path (mono=%s)", (mono) => {
  const label = `${mono ? "[O]" : marker} oc mini`
  const metadata = mono ? " vlocal - a/b/c" : " vlocal · a/b/c"
  expect(
    entrySplashLayout({ width: stringWidth(label + metadata), version: "local", detail: "a/b/c", mono }),
  ).toMatchObject({ label, metadata, path: "a/b/c" })
})

test.each([false, true])(
  "entry writer chooses the same representation regardless of previous widths (mono=%s)",
  async (mono) => {
    const writer = entrySplash({ version: "local", detail: "~/src/wt/oc-mini-v2", theme, mono })
    const first = await renderSplash(writer, 112)
    for (const width of [24, 40, 16]) await renderSplash(writer, width)
    expect((await renderSplash(writer, 112)).rows).toEqual(first.rows)
  },
)

test.each(sizes.flatMap((size) => [false, true].map((showSession) => ({ ...size, showSession }))))(
  "exit retains the complete resume command (%o)",
  async (input) => {
    const result = await renderSplash(
      exitSplash({ ...input, title: "Review mini layout", session_id: sessionID, theme }),
      input.width,
    )
    const command = `opencode mini -s ${sessionID}`
    const commandRows =
      input.width >= 80 ? [result.rows[2].slice(result.rows[2].indexOf("opencode"))] : result.rows.slice(1)
    const reconstructed = commandRows
      .map((row, index) => (index < commandRows.length - 1 ? row.padEnd(input.width) : row))
      .join("")
    expect(reconstructed).toBe(command)
    expect(reconstructed.slice("opencode mini -s ".length)).toBe(sessionID)
    if (input.width >= 80) {
      expect(result.rows[1].startsWith(input.mono ? "[O]" : "█▀▀█")).toBe(true)
      expect(result.rows[1].includes("Session  Review mini layout")).toBe(input.showSession)
      expect(result.rows[2]).toContain("Continue " + command)
    } else {
      expect(result.rows.join("\n")).not.toMatch(/Session|Continue|Review mini layout|█|\[O\]/)
      expect(result.rows).toHaveLength(1 + Math.ceil(command.length / input.width))
    }
    if (input.mono) expect(result.rows.join("")).not.toMatch(/[^\x20-\x7e]/)
    expect(result.spans.find((span) => span.text.includes("opencode"))?.fg.intent).toBe("default")
    expect(result.spans.find((span) => span.text.includes("opencode"))?.fg.toInts()).toEqual(theme.right.toInts())
  },
)
