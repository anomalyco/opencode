/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { DiffRenderable, type Renderable, SyntaxStyle } from "@opentui/core"
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
          hunkBg="#222222"
          hunkFg="#888888"
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
  const frame = await app.waitForFrame((value) =>
    value.includes("@@ -20,3 +20,3 @@"),
  )
  const header = frame
    .split("\n")
    .find((line) => line.includes("@@ -20,3 +20,3 @@"))

  expect(header?.startsWith("@@ -20,3 +20,3 @@")).toBe(true)
  expect(header?.trimEnd()).toBe("@@ -20,3 +20,3 @@")
  expect(findDiffs(app.renderer.root)).toHaveLength(2)
})

function findDiffs(root: Renderable): DiffRenderable[] {
  return [
    ...(root instanceof DiffRenderable ? [root] : []),
    ...root.getChildren().flatMap((child) => findDiffs(child)),
  ]
}
