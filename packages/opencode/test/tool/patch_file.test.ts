import { expect, describe, it } from "bun:test"
import * as crypto from "crypto"

// Reproduce patch_file.ts helpers inline for unit testing.
function computeAnchor(lines: string[], centerLine: number, contextLines: number): string {
  const from = Math.max(0, centerLine - contextLines)
  const to = Math.min(lines.length - 1, centerLine + contextLines)
  return crypto.createHash("sha256").update(lines.slice(from, to + 1).join("\n")).digest("hex")
}

function buildAnchorMap(content: string, contextLines: number) {
  const lines = content.split("\n")
  return lines.map((line, i) => ({
    anchor_hash: computeAnchor(lines, i, contextLines),
    line: i,
    context_lines: contextLines,
    preview: line.slice(0, 80),
  }))
}

function resolvePatch(lines: string[], patch: { anchor_hash: string; search: string; replace: string; context_lines?: number }) {
  const contextLines = patch.context_lines ?? 0
  const anchorLine = buildAnchorMap(lines.join("\n"), contextLines).find((a) => a.anchor_hash === patch.anchor_hash)?.line
  if (anchorLine === undefined) throw new Error("[patch_file] anchor_hash not found")

  const searchLines = patch.search.split("\n")
  const start = anchorLine
  const end = start + searchLines.length - 1
  const window = lines.slice(start, end + 1).join("\n")
  if (window !== patch.search) throw new Error(`[patch_file] Search text does not match at anchor line ${start}`)

  return { startLine: start, endLine: end, search: patch.search, replace: patch.replace }
}

function applyPatches(lines: string[], patches: { startLine: number; endLine: number; replace: string }[]) {
  const sorted = [...patches].sort((a, b) => b.startLine - a.startLine)
  const result = [...lines]
  for (const p of sorted) {
    result.splice(p.startLine, p.endLine - p.startLine + 1, ...p.replace.split("\n"))
  }
  return result
}

function hasOverlap(sorted: { startLine: number; endLine: number }[]): boolean {
  return sorted.some((p, i) => i > 0 && p.startLine <= sorted[i - 1].endLine)
}

const sample = `function hello() {
  console.log("hello world")
}

function goodbye() {
  console.log("goodbye world")
}`

describe("patch_file core logic", () => {
  it("computes anchors and resolves a patch", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)
    const target = anchors.find((a) => a.preview.includes('console.log("hello world")'))!
    expect(target).toBeTruthy()

    const patch = resolvePatch(lines, {
      anchor_hash: target.anchor_hash,
      search: '  console.log("hello world")',
      replace: '  console.log("hello, Pietro!")',
      context_lines: 0,
    })

    expect(patch.startLine).toBe(1)
    expect(patch.endLine).toBe(1)

    const newLines = applyPatches(lines, [patch])
    expect(newLines.join("\n")).toContain('console.log("hello, Pietro!")')
  })

  it("applies multiple non-overlapping patches", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)

    const p1 = resolvePatch(lines, {
      anchor_hash: anchors.find((a) => a.line === 1)!.anchor_hash,
      search: lines[1],
      replace: "  // replaced hello",
      context_lines: 0,
    })

    const p2 = resolvePatch(lines, {
      anchor_hash: anchors.find((a) => a.line === 5)!.anchor_hash,
      search: lines[5],
      replace: "  // replaced goodbye",
      context_lines: 0,
    })

    const sorted = [p1, p2].sort((a, b) => a.startLine - b.startLine)
    expect(hasOverlap(sorted)).toBe(false)

    const newLines = applyPatches(lines, [p1, p2])
    expect(newLines[1]).toBe("  // replaced hello")
    expect(newLines[5]).toBe("  // replaced goodbye")
  })

  it("detects overlapping patches", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)

    // p1 targets line 1 only
    const p1 = resolvePatch(lines, {
      anchor_hash: anchors.find((a) => a.line === 1)!.anchor_hash,
      search: lines[1],
      replace: "// changed1",
      context_lines: 0,
    })

    // p2 targets lines 1-2 (overlaps p1)
    const p2 = resolvePatch(lines, {
      anchor_hash: anchors.find((a) => a.line === 1)!.anchor_hash,
      search: lines[1] + "\n" + lines[2],
      replace: "// changed2",
      context_lines: 0,
    })

    const sorted = [p1, p2].sort((a, b) => a.startLine - b.startLine)
    expect(hasOverlap(sorted)).toBe(true)
  })

  it("rejects anchor after file drift", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)
    const oldAnchor = anchors.find((a) => a.line === 1)!

    // Modify the target line itself to change its anchor
    const driftedLines = [...lines]
    driftedLines[1] = "  // modified"
    const drifted = driftedLines.join("\n")
    const newAnchors = buildAnchorMap(drifted, 0)

    const stillValid = newAnchors.some((a) => a.anchor_hash === oldAnchor.anchor_hash)
    expect(stillValid).toBe(false)

    expect(() =>
      resolvePatch(driftedLines, {
        anchor_hash: oldAnchor.anchor_hash,
        search: driftedLines[1],
        replace: "// changed",
        context_lines: 0,
      }),
    ).toThrow("anchor_hash not found")
  })

  it("handles CRLF content correctly", () => {
    const crlf = "line1\r\nline2\r\nline3"
    const lines = crlf.split("\n")
    // Our split on \n keeps \r at end of lines except last
    expect(lines).toEqual(["line1\r", "line2\r", "line3"])

    // Anchor computation should use the split lines as-is, preserving \r
    const anchors = buildAnchorMap(crlf, 0)
    const target = anchors.find((a) => a.line === 1)!
    expect(target).toBeTruthy()

    const patch = resolvePatch(lines, {
      anchor_hash: target.anchor_hash,
      search: "line2\r",
      replace: "line2_replaced\r",
      context_lines: 0,
    })

    const newLines = applyPatches(lines, [patch])
    expect(newLines.join("\n")).toBe("line1\r\nline2_replaced\r\nline3")
  })

  it("rejects wrong search text at anchor", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)
    const target = anchors.find((a) => a.line === 1)!

    expect(() =>
      resolvePatch(lines, {
        anchor_hash: target.anchor_hash,
        search: "this does not match",
        replace: "// changed",
        context_lines: 0,
      }),
    ).toThrow("Search text does not match")
  })
})
