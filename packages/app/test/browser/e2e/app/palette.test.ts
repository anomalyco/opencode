import { describe, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { openPalette } from "../../../../e2e/actions"

describe("palette", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("search palette opens and closes", async () => {
    await app.gotoSession()
    const dialog = await openPalette(app.page)
    await app.page.keyboard.press("Escape")
    await dialog.waitFor({ state: "detached", timeout: 10_000 })
  })
})
