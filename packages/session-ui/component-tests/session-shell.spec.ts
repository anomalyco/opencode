import { expect, story } from "../../storybook/playwright/story"

story("streams user shell output and retains the saved completion", async ({ mount }) => {
  const root = await mount("current-session-terminal-work--live-user-command")
  const shell = root.locator('[data-component="session-shell-message"]')
  const output = shell.locator('[data-slot="bash-result"]')
  await expect(shell.locator('[data-slot="bash-command"]')).toHaveText("printf ready")
  await expect(output).toHaveText("ready\n")
  await root.getByRole("button", { name: "Update output", exact: true }).click()
  await expect(output).toHaveText("ready\nnext line\n")
  await root.getByRole("button", { name: "Complete command", exact: true }).click()
  await expect(output).toHaveText("ready\nnext line\nfinished\n")
  await expect(shell.locator('[data-kind="tool-error-card"]')).toHaveCount(0)
})

for (const [outcome, error] of [
  ["nonzero", "Command exited with code 1"],
  ["timeout", "Command timed out"],
  ["killed", "Command cancelled"],
]) {
  story(`shows a direct shell ${outcome} outcome even without output`, async ({ mount }) => {
    const root = await mount("current-session-terminal-work--live-user-command", { args: { outcome, output: false } })
    const shell = root.locator('[data-component="session-shell-message"]')
    await root.getByRole("button", { name: "Complete command", exact: true }).click()
    await expect(shell.locator('[data-kind="tool-error-card"]')).toContainText(error)
    await expect(shell.locator('[data-slot="bash-command"]')).toHaveText("printf ready")
    await expect(shell.locator('[data-slot="bash-result"]')).toHaveCount(0)
  })
}

for (const [id, output] of [
  ["running-a-user-command", "Starting Storybook manager...\nBuilding preview..."],
  ["user-command-completed", " M packages/session-ui/src/timeline/session-timeline.tsx"],
]) {
  story(`keeps captured output without a live reader: ${id}`, async ({ mount }) => {
    const root = await mount(`current-session-terminal-work--${id}`)
    await expect(root.locator('[data-component="session-shell-message"] [data-slot="bash-result"]')).toHaveText(output)
  })
}
