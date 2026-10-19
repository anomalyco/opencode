/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RunPermissionBody } from "../../src/mini/footer.permission"
import { screenReader } from "../../src/mini/screen-reader"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"

afterEach(() => {
  screenReader.enabled = false
})

test("the cursor follows the selected permission button in screen reader mode", async () => {
  screenReader.enabled = true
  const app = await testRender(
    () => (
      <RunPermissionBody
        request={{ id: "per_sr", sessionID: "ses_sr", action: "shell", resources: ["ls"], save: ["/project/*"] }}
        theme={RUN_THEME_FALLBACK.footer}
        block={RUN_THEME_FALLBACK.block}
        onReply={() => {}}
      />
    ),
    { width: 80, height: 16, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    const first = app.renderer.getCursorState().x
    app.mockInput.pressTab()
    await app.renderOnce()
    expect(app.renderer.getCursorState().x).toBeGreaterThan(first)
  } finally {
    app.renderer.destroy()
  }
})
