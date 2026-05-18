import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"

describe("home bootstrap", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("home load emits no console errors", async () => {
    const errors: string[] = []
    app.page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    app.page.on("pageerror", (err) => {
      errors.push(err.message)
    })
    await app.page.goto("/")
    await app.page.getByRole("button", { name: "Open project" }).first().waitFor({ state: "visible" })
    await expect.poll(() => errors.slice(), { timeout: 8_000 }).toEqual([])
  })
})
