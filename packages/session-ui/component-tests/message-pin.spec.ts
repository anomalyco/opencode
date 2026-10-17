import { expect, story } from "../../storybook/playwright/story"

// The pin store is app-owned; these tests cover the timeline controls that render and toggle it.
story("pins and unpins a user message and an assistant response", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })

  const userActions = timeline.locator('[data-slot="user-message-copy-wrapper"]').first()
  const responseActions = timeline.locator('[data-slot="text-part-copy-wrapper"]').first()

  await userActions.locator("..").hover()
  const pinMessage = userActions.getByRole("button", { name: "Pin message", exact: true })
  await expect(pinMessage).toBeVisible()
  await pinMessage.click()
  await expect(userActions.getByRole("button", { name: "Unpin message", exact: true })).toBeVisible()
  await expect(pinMessage).toHaveCount(0)

  await responseActions.locator("..").hover()
  const pinResponse = responseActions.getByRole("button", { name: "Pin response", exact: true })
  await expect(pinResponse).toBeVisible()
  await pinResponse.click()
  await expect(responseActions.getByRole("button", { name: "Unpin response", exact: true })).toBeVisible()

  await userActions.getByRole("button", { name: "Unpin message", exact: true }).click()
  await expect(userActions.getByRole("button", { name: "Pin message", exact: true })).toBeVisible()
})
