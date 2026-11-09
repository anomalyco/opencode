import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./dialog-context.fixture.tsx", import.meta.url))

for (const mode of ["show", "push"] as const) {
  for (const closing of [true, false]) {
    const context = closing
      ? "the caller's context after the previous dialog starts closing"
      : "the open dialog's context"

    story(`${mode} uses ${context}`, async ({ page, mount }) => {
      await mount("ui-button--variants")
      await page.evaluate(
        async ({ fixture, mode, closing }) => {
          const { mountDialogContext } = await import(fixture)
          mountDialogContext(mode, closing)
        },
        { fixture, mode, closing },
      )
      await page.getByTestId("dialog-context").getByRole("button", { name: "Add SSH server", exact: true }).click()
      const ssh = page.getByRole("dialog", { name: "SSH connection", exact: true })
      await expect(ssh.getByRole("button", { name: "Finish connection", exact: true })).toBeEnabled()
      await page.clock.install({ time: new Date("2026-11-08T21:00:00Z") })
      await page.clock.pauseAt(new Date("2026-11-08T21:00:01Z"))
      await ssh.getByRole("button", { name: "Finish connection", exact: true }).click()
      await expect(page.getByRole("dialog", { name: "Remote project", exact: true })).toContainText(
        "/home/devbox/project",
      )
      await expect(page.getByTestId("dialog-context").getByRole("alert")).toHaveCount(0)
    })
  }
}
