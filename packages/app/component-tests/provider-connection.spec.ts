import { expect, sourceURL, story } from "../../stories/playwright/story"
import type { Scenario } from "./provider-connection.fixture"

const fixture = sourceURL(new URL("./provider-connection.fixture.tsx", import.meta.url))

for (const scenario of ["expired", "missing", "next", "complete"] satisfies Scenario[]) {
  story(`recovers ${scenario} setup after losing the submission response`, async ({ mount, page }) => {
    await mount("ui-line-comment--editor")
    await page.evaluate(
      async ({ fixture, scenario }) => {
        const module = await import(fixture)
        module.mountConnection(scenario)
      },
      { fixture, scenario },
    )
    const connection = page.getByTestId("provider-connection")
    await connection.getByRole("button", { name: "Start", exact: true }).click()
    await expect(connection.getByTestId("step")).toHaveText("step_1")
    await connection.getByRole("button", { name: "Submit", exact: true }).click()
    await expect(connection.getByTestId("state")).toHaveText("error")
    await connection.getByRole("button", { name: "Retry", exact: true }).click()
    if (scenario === "complete") {
      await expect(connection.getByTestId("receipt")).toHaveText("Manage budget")
      return
    }
    await expect(connection.getByTestId("step")).toHaveText(scenario === "next" ? "step_2" : "step_1")
    await expect(connection.getByTestId("attempts")).toHaveText(scenario === "next" ? "attempt_1" : "attempt_2")
    if (scenario !== "next")
      await expect(connection.getByTestId("answers")).toHaveText(
        JSON.stringify([{ credentialID: "cred_existing" }, { credentialID: "cred_existing" }]),
      )
  })
}

story("sends hidden defaults with a dynamic setup answer", async ({ mount, page }) => {
  await mount("ui-line-comment--editor")
  await page.evaluate(async (fixture) => {
    const module = await import(fixture)
    module.mountConnection("hidden")
  }, fixture)
  const connection = page.getByTestId("provider-connection")
  await connection.getByRole("button", { name: "Start", exact: true }).click()
  await expect(connection.getByTestId("step")).toHaveText("step_1")
  await connection.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(connection.getByTestId("receipt")).toHaveText("Manage budget")
  await expect(connection.getByTestId("submissions")).toHaveText(
    JSON.stringify([{ server: "https://example.com", scope: "gateway", name: "OpenCode" }]),
  )
})
