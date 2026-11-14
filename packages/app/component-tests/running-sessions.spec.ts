import { expect, story } from "../../stories/playwright/story"

story("running rows combine execution and shells without refreshing existing sessions", async ({ mount }) => {
  const root = await mount("sidebar-running--overview")
  const list = root.getByRole("region", { name: "Running" })
  await expect(list.getByRole("button")).toHaveCount(2)
  await expect(root.getByLabel("Build requests")).toHaveText("1,1,1")
  await expect(list.getByRole("button", { name: /^Background/ })).toContainText("Background")

  await root.getByRole("button", { name: "Start child", exact: true }).click()
  await expect(list.getByRole("button")).toHaveCount(3)
  await expect(root.getByLabel("Child requests")).toHaveText("1,1,1")
  await expect(root.getByLabel("Build requests")).toHaveText("1,1,1")
  await root.getByRole("button", { name: "Start build shell", exact: true }).click()
  await expect(list.getByRole("button", { name: /^Build/ })).toHaveAttribute("title", /bun run build/)
  await expect(list.getByRole("button")).toHaveCount(3)
  await expect(root.getByLabel("Build requests")).toHaveText("1,1,1")

  await list.getByRole("button", { name: /^Child/ }).click()
  await expect(root.getByLabel("Opened session")).toHaveText("child")
  await expect(root.getByLabel("Touched project")).toHaveText("/project")
  await expect(list.getByRole("button", { name: /^Child/ })).toHaveAttribute("aria-current", "page")

  await root.getByRole("button", { name: "Stop shells", exact: true }).click()
  await expect(list.getByRole("button")).toHaveCount(2)
  await expect(root.getByLabel("Build requests")).toHaveText("1,1,1")
  await root.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(list.getByRole("button")).toHaveCount(0)
  await root.getByRole("button", { name: "Reconnect", exact: true }).click()
  await expect(list.getByRole("button")).toHaveCount(2)
  await expect(root.getByLabel("Build requests")).toHaveText("2,2,2")
  await expect(root.getByLabel("Child requests")).toHaveText("2,2,2")
})

story("running branches retry and recover after reconnect with the Inbox loader", async ({ mount, page }) => {
  await page.clock.install()
  const root = await mount("sidebar-running--retry")
  await expect(root.getByLabel("Branch attempts")).toHaveText("1")
  await page.clock.fastForward(1_000)
  await expect(root.getByLabel("Branch attempts")).toHaveText("2")
  await page.clock.fastForward(2_000)
  await expect(root.getByLabel("Branch attempts")).toHaveText("3")
  await root.getByRole("button", { name: "Disconnect", exact: true }).click()
  await root.getByRole("button", { name: "Reconnect", exact: true }).click()
  await expect(root.getByLabel("Branch attempts")).toHaveText("4")
  await expect(root.getByRole("region", { name: "Running" }).getByRole("button", { name: /^Build/ })).toContainText(
    "main",
  )
})
