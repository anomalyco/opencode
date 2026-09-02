import { expect, story } from "../../storybook/playwright/story"

story("renders the line comment cancel action as a ghost button", async ({ mount }) => {
  const root = await mount("ui-line-comment--editor-filled")
  await expect(root.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "ghost")
})
