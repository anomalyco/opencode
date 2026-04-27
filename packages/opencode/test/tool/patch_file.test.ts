import { expect, describe, it } from "bun:test"
import { computeAnchor, buildAnchorMap, resolvePatch, applyPatches } from "../../src/tool/patch_file"

const sample = `function hello() {
  console.log("hello world")
}

function goodbye() {
  console.log("goodbye world")
}`

describe("patch_file core logic", () => {
  it("computes anchors and resolves a patch", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 5)
    const target = anchors.find((a) => a.preview.includes('console.log("hello world")'))!
    expect(target).toBeTruthy()

    const patch = resolvePatch(lines, {
      anchor_hash: target.anchor_hash,
      search: '  console.log("hello world")',
      replace: '  console.log("hello, Pietro!")',
      context_lines: 5,
    })

    expect(patch.startLine).toBe(0)
    expect(patch.endLine).toBe(6)

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

    const newLines = applyPatches(lines, [p1, p2])
    expect(newLines[1]).toBe("  // replaced hello")
    expect(newLines[5]).toBe("  // replaced goodbye")
  })

  it("rejects anchor after file drift", () => {
    const lines = sample.split("\n")
    const anchors = buildAnchorMap(sample, 0)
    const oldAnchor = anchors.find((a) => a.line === 1)!

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
    ).toThrow("anchor_hash")
  })

  it("handles CRLF content correctly", () => {
    const crlf = "line1\r\nline2\r\nline3"
    const lines = crlf.split("\n")
    expect(lines).toEqual(["line1\r", "line2\r", "line3"])

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
    ).toThrow("search text not present")
  })
})
