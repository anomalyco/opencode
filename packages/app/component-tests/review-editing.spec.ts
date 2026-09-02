import { expect, story } from "../../storybook/playwright/story"

story("keeps same-path drafts separate when switching workspaces", async ({ mount, page }) => {
  const root = await mount("app-review-editing--workspaces")
  const editor = root.getByRole("textbox", { name: "src/shared.ts", exact: true })
  await root.getByRole("button", { name: "Edit file", exact: true }).click()
  await expect(editor).toHaveText("// Workspace A\n", { useInnerText: true })
  await editor.focus()
  await editor.press("ControlOrMeta+a")
  await page.keyboard.insertText("// Draft A\n")
  await expect(editor).toHaveText("// Draft A\n", { useInnerText: true })

  await root.getByRole("button", { name: "Workspace B", exact: true }).click()
  await root.getByRole("button", { name: "Edit file", exact: true }).click()
  await expect(editor).toHaveText("// Workspace B\n", { useInnerText: true })
  await editor.focus()
  await editor.press("ControlOrMeta+a")
  await page.keyboard.insertText("// Draft B\n")
  await expect(editor).toHaveText("// Draft B\n", { useInnerText: true })

  await root.getByRole("button", { name: "Workspace A", exact: true }).click()
  await expect(editor).toHaveText("// Draft A\n", { useInnerText: true })
  await editor.press("ControlOrMeta+End")
  await page.keyboard.insertText("// Still A")
  await expect(editor).toContainText("// Still A")
  await root.getByRole("button", { name: "Workspace B", exact: true }).click()
  await expect(editor).toHaveText("// Draft B\n", { useInnerText: true })
})
