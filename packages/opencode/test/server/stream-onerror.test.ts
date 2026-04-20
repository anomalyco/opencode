/**
 * Regression test for upstream issue #17521 / #10631:
 *
 * Hono's `stream()` and `streamSSE()` helpers fall back to `console.error(e)`
 * when the streaming callback throws and no `onError` handler is provided.
 * In opencode that turns any user-input error (bad model id, missing provider,
 * etc.) into a Bun-formatted source-context stack trace dumped to the user's
 * terminal — the very issue that #10631 / #17521 / #16925 are filed for.
 *
 * The fix is to ALWAYS pass an `onError` handler that routes through our
 * Logger (which by default writes to a log file, not stderr). This test is a
 * static check: it grep-scans `src/server/routes/**` for `streamSSE(` and
 * `stream(` calls and asserts each one is followed (within a reasonable
 * window) by an `async (err)` / `(err)` argument. Cheap and catches regressions
 * the second someone forgets it on a new endpoint.
 */

import { describe, expect, it } from "bun:test"
import { Glob } from "@opencode-ai/shared/util/glob"
import path from "path"

const ROOT = path.join(import.meta.dir, "..", "..", "src", "server", "routes")

async function listRouteFiles(): Promise<string[]> {
  return Glob.scan("**/*.ts", { cwd: ROOT, absolute: true, include: "file" })
}

describe("server streaming endpoints have onError handlers", () => {
  it("every streamSSE/stream callsite passes onError so errors don't reach console.error", async () => {
    const files = await listRouteFiles()
    expect(files.length).toBeGreaterThan(0)

    const violations: { file: string; line: number; snippet: string }[] = []

    for (const file of files) {
      const text = await Bun.file(file).text()
      const lines = text.split("\n")

      // Find the line where streamSSE( or stream( starts.
      // Note the parenthesis is required so we don't match `import { stream }` etc.
      const opens: { kind: "streamSSE" | "stream"; line: number }[] = []
      lines.forEach((line, i) => {
        if (/\bstreamSSE\(/.test(line)) opens.push({ kind: "streamSSE", line: i })
        else if (/(?:return|=)\s*stream\(/.test(line)) opens.push({ kind: "stream", line: i })
      })

      // For each opener, find the matching closing `)` by tracking paren depth
      // across the rest of the file, then check whether the section between has
      // exactly two top-level callbacks (the cb + onError) instead of just one.
      for (const open of opens) {
        // Locate the index of the opening "(" of this call
        const startLine = lines[open.line]
        const startCol = startLine.indexOf(open.kind + "(") + open.kind.length
        let depth = 0
        let lineIdx = open.line
        let colIdx = startCol
        let topLevelCommas = 0
        let scanned = 0
        outer: for (; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]
          for (; colIdx < line.length; colIdx++) {
            const ch = line[colIdx]
            scanned++
            if (scanned > 50_000) break outer // safety bail-out
            if (ch === "(") depth++
            else if (ch === ")") {
              depth--
              if (depth === 0) break outer
            } else if (ch === "," && depth === 1) {
              topLevelCommas++
            }
          }
          colIdx = 0
        }
        // Args = topLevelCommas + 1 (e.g. 1 comma → 2 args). For both stream
        // helpers the signature is (c, cb, onError?), so we need 3 args = 2
        // top-level commas to ensure onError is present.
        if (topLevelCommas < 2) {
          violations.push({
            file: path.relative(ROOT, file),
            line: open.line + 1,
            snippet: `${open.kind}( ... ${topLevelCommas + 1} top-level argument(s), expected 3 (c, cb, onError)`,
          })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations.map((v) => `  ${v.file}:${v.line}  ${v.snippet}`).join("\n")
      throw new Error(
        `streamSSE/stream callsites missing onError handler — these will console.error stack traces on user-input errors. Fix: add an onError callback that logs via our Logger.\n\n${detail}\n\nSee https://github.com/anomalyco/opencode/issues/17521`,
      )
    }
    expect(violations).toEqual([])
  })
})
