/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { DiffRenderable, parseColor, type Renderable, SyntaxStyle } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { PatchDiff } from "../../src/component/patch-diff"

let app: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  app?.renderer.destroy()
  app = undefined
})

test("renders separate diff nodes with a full-width hunk row", async () => {
  const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const first = true
+const addedFirst = true
 const afterFirst = true
@@ -20,3 +20,3 @@
 const second = true
-const oldSecond = true
+const newSecond = true
 const afterSecond = true`

  app = await testRender(
    () => (
      <box width={120}>
        <PatchDiff
          diff={patch}
          hunkFg="#888888"
          lineNumberBg="#222222"
          view="split"
          filetype="typescript"
          syntaxStyle={SyntaxStyle.create()}
          showLineNumbers={true}
          width="100%"
        />
      </box>
    ),
    { width: 120, height: 30 },
  )
  await app.waitForFrame((value) => value.includes("@@ -20,3 +20,3 @@"))
  await app.renderOnce()
  const frame = app.captureCharFrame()
  const headerRow = frame.split("\n").findIndex((line) => line.includes("@@ -20,3 +20,3 @@"))
  const header = frame.split("\n")[headerRow]
  const firstLine = frame.split("\n").find((line) => line.includes("const first")) ?? ""
  const secondLine = frame.split("\n").find((line) => line.includes("const second")) ?? ""
  const background = parseColor("#222222")

  expect(header?.startsWith(" @@ -20,3 +20,3 @@")).toBe(true)
  expect(header?.trimEnd()).toBe(" @@ -20,3 +20,3 @@")
  expect(
    app
      .captureSpans()
      .lines[headerRow].spans.every(
        (span) =>
          span.bg.r === background.r &&
          span.bg.g === background.g &&
          span.bg.b === background.b &&
          span.bg.a === background.a,
      ),
  ).toBe(true)
  const diffs = findDiffs(app.renderer.root)
  const gutters = diffs.flatMap((diff) => diff.getChildren().flatMap((side) => side.getChildren().slice(0, 1)))
  expect(diffs).toHaveLength(2)
  expect(gutters[0].width).toBeGreaterThan(0)
  expect(new Set(gutters.map((gutter) => gutter.width)).size).toBe(1)
  expect(firstLine.search(/\d/)).toBe(secondLine.search(/\d/))
})

function findDiffs(root: Renderable): DiffRenderable[] {
  return [
    ...(root instanceof DiffRenderable ? [root] : []),
    ...root.getChildren().flatMap((child) => findDiffs(child)),
  ]
}
