import { expect, story } from "../../stories/playwright/story"

for (const empty of [false, true]) {
  story(
    `copies ${empty ? "an empty snapshot without a disk reader" : "the reviewed snapshot instead of later disk edits"}`,
    async ({ mount, page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"])
      const root = await mount("review-file-preview-v2--copy-snapshot", { args: { empty, reader: !empty } })
      await page.evaluate(() => navigator.clipboard.writeText("previous clipboard"))
      await root.getByRole("button", { name: "Copy file contents", exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(empty ? "" : "export const value = 'reviewed'\n// unchanged beyond the edit\n")
    },
  )
}
