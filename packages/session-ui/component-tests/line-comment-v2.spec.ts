import { expect, story } from "../../stories/playwright/story"

story("renders the line comment cancel action as a ghost button", async ({ mount }) => {
  const root = await mount("ui-line-comment--editor-filled")
  await expect(root.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "ghost")
})

story("keeps the line breaks of a submitted comment", async ({ mount }) => {
  const root = await mount("ui-line-comment--display-multiline")
  // toHaveText collapses whitespace, so compare the rendered text exactly.
  await expect(root.locator('[data-slot="line-comment-v2-text"]')).toHaveJSProperty(
    "innerText",
    "Consider guarding against empty arrays.\n\nAn early return keeps the happy path flat.",
  )
})
