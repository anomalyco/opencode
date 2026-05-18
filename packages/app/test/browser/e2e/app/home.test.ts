import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { serverNamePattern } from "../../../../e2e/utils"

describe("home", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("home renders and shows core entrypoints", async () => {
    await app.page.goto("/")
    await app.page.getByRole("button", { name: "Open project" }).first().waitFor({ state: "visible" })
    await app.page.getByRole("button", { name: serverNamePattern() }).waitFor({ state: "visible" })
  })

  test("server picker dialog opens from home", async () => {
    await app.page.goto("/")
    const trigger = app.page.getByRole("button", { name: serverNamePattern() })
    await trigger.waitFor({ state: "visible" })
    await trigger.click()
    const dialog = app.page.getByRole("dialog")
    await dialog.waitFor({ state: "visible" })
    await dialog.getByRole("textbox").first().waitFor({ state: "visible" })
  })
})
