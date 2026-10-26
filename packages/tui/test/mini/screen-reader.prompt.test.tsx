/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RunPromptBody } from "../../src/mini/footer.prompt"
import { screenReader } from "../../src/mini/screen-reader"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"

afterEach(() => {
  screenReader.enabled = false
})

async function firstLine(enabled: boolean) {
  screenReader.enabled = enabled
  const app = await testRender(
    () => (
      <RunPromptBody
        theme={() => RUN_THEME_FALLBACK.footer}
        background={() => "transparent"}
        rail={() => "white"}
        mono
        cursorStyle={undefined}
        placeholder={() => ""}
        onSubmit={() => {}}
        onKeyDown={() => {}}
        onPaste={async () => {}}
        images={() => []}
        layout={() => ({ padding: 0, images: 0, textarea: 3 }) as never}
        onContentChange={() => {}}
        onSizeChange={() => {}}
        bind={() => {}}
      />
    ),
    { width: 40, height: 3 },
  )
  try {
    await app.renderOnce()
    return app.captureCharFrame().split("\n")[0]!
  } finally {
    app.renderer.destroy()
  }
}

test("the prompt starts with a dollar sign in screen reader mode", async () => {
  expect(await firstLine(true)).toContain("$ ")
})

test("the prompt has no dollar sign outside screen reader mode", async () => {
  expect(await firstLine(false)).not.toContain("$")
})
