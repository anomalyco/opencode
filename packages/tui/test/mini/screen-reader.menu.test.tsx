/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { RunFooterMenu } from "../../src/mini/footer.menu"
import { screenReader } from "../../src/mini/screen-reader"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"

afterEach(() => {
  screenReader.enabled = false
})

async function selectedRows(enabled: boolean) {
  screenReader.enabled = enabled
  const [selected, setSelected] = createSignal(0)
  const app = await testRender(
    () => (
      <RunFooterMenu
        cursor
        theme={() => RUN_THEME_FALLBACK.footer}
        items={() => [{ display: "First" }, { display: "Second" }, { display: "Third" }]}
        selected={selected}
        offset={() => 0}
        rows={() => 3}
      />
    ),
    { width: 40, height: 6 },
  )
  try {
    const rows: number[] = []
    for (const index of [0, 2, 1]) {
      setSelected(index)
      await app.renderOnce()
      rows.push(app.renderer.getCursorState().y)
    }
    return rows
  } finally {
    app.renderer.destroy()
  }
}

test("the cursor follows the selected menu row in screen reader mode", async () => {
  const rows = await selectedRows(true)
  expect(rows[1]! - rows[0]!).toBe(2)
  expect(rows[2]! - rows[0]!).toBe(1)
})

test("the cursor stays put outside screen reader mode", async () => {
  expect(new Set(await selectedRows(false)).size).toBe(1)
})
