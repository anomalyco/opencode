import { expect, story } from "../../storybook/playwright/story"

story.use({ hasTouch: true, isMobile: true, viewport: { width: 800, height: 844 } })

story("submits on the first touch without retaining a hover style", async ({ mount }) => {
  const component = await mount("opencode-composer-flow--failed-submission-restoration")
  const submit = component.getByRole("button", { name: "Send", exact: true })
  const background = await submit.evaluate((element) => getComputedStyle(element).backgroundImage)

  await submit.tap()

  await expect(component.getByRole("status")).toHaveText("Submission failed; draft restored")
  await expect(submit).toHaveCSS("background-image", background)
})
