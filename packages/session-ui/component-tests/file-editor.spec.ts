import { expect, story } from "../../storybook/playwright/story"

for (const theme of ["light", "dark"]) {
  story(`edits full contents with native undo and redo in ${theme}`, async ({ mount, page }) => {
    const root = await mount("components-file-editor--default", { globals: { theme } })
    const editor = root.getByRole("textbox", { name: "src/greeting.ts" })
    await expect(editor).toBeVisible()
    await expect(root.locator("diffs-container")).toHaveAttribute("data-color-scheme", theme)
    await expect(root.locator('[data-line] [style*="--syntax-"]')).not.toHaveCount(0)
    const colors = await editor
      .locator('[data-line="1"] [data-char]')
      .evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color))
    await expect(root.getByTestId("editor-changes")).toHaveText("Changes: 0")
    await editor.focus()
    await page.keyboard.press("ControlOrMeta+Home")
    await page.keyboard.type("// note\n")
    await expect(root.getByTestId("editor-contents")).toHaveJSProperty(
      "textContent",
      '// note\nexport const greeting = "Hello"\nexport const message = "Hello again"\n',
    )
    await page.setViewportSize({ width: 1000, height: 720 })
    await expect
      .poll(() =>
        editor
          .locator('[data-line="2"] [data-char]')
          .evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color)),
      )
      .toEqual(colors)
    await page.keyboard.press("ControlOrMeta+z")
    await expect(root.getByTestId("editor-contents")).toHaveJSProperty(
      "textContent",
      '// noteexport const greeting = "Hello"\nexport const message = "Hello again"\n',
    )
    await page.keyboard.press("ControlOrMeta+Shift+z")
    await expect(root.getByTestId("editor-contents")).toHaveJSProperty(
      "textContent",
      '// note\nexport const greeting = "Hello"\nexport const message = "Hello again"\n',
    )
    await expect(root.getByTestId("editor-error")).toBeEmpty()
  })
}

story("native find and replace do not trigger review navigation", async ({ mount, page }) => {
  const root = await mount("components-file-editor--default")
  const editor = root.getByRole("textbox", { name: "src/greeting.ts" })
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ControlOrMeta+f")
  await root.locator("input[data-search]").fill("Hello")
  await expect(root.locator("[data-matches]")).toContainText("2")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Escape")
  await expect(root.locator("input[data-search]")).toHaveCount(0)
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+Alt+f")
  await root.locator("input[data-search]").fill("Hello")
  await root.locator("input[data-replace]").fill("Welcome")
  await root.getByRole("button", { name: "Replace All", exact: true }).click()
  await expect(root.getByTestId("editor-contents")).toHaveJSProperty(
    "textContent",
    'export const greeting = "Welcome"\nexport const message = "Welcome again"\n',
  )
  await expect(root.getByTestId("editor-navigation")).toHaveText("Navigation: 0")
  await expect(root.getByTestId("editor-error")).toBeEmpty()
})

story("preserves the editor and its history across theme changes in a narrow RTL shell", async ({ mount, page }) => {
  await page.setViewportSize({ width: 380, height: 700 })
  const root = await mount("components-file-editor--default", {
    args: { narrow: true },
    globals: { theme: "light", direction: "rtl", locale: "ar" },
  })
  const editor = root.getByRole("textbox", { name: "src/greeting.ts" })
  await expect(editor).toHaveCSS("direction", "ltr")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.type("x")
  const host = await root.locator("diffs-container").elementHandle()
  await root.getByRole("button", { name: "Toggle theme" }).click()
  await expect(root.locator("diffs-container")).toHaveAttribute("data-color-scheme", "dark")
  expect(await host?.evaluate((node) => node === document.querySelector("diffs-container"))).toBe(true)
  await expect(root.getByTestId("editor-contents")).toContainText("xexport")
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(root.getByTestId("editor-contents")).toContainText("export const greeting")
  await expect(root.getByTestId("editor-contents")).not.toContainText("xexport")
  await root.locator('[data-component="file-editor"]').evaluate((node) => {
    if (node instanceof HTMLElement) node.style.setProperty("--syntax-keyword", "rgb(120, 80, 200)")
  })
  await expect(editor.getByText("export", { exact: true }).first()).toHaveCSS("color", "rgb(120, 80, 200)")
  await expect(root.getByTestId("editor-error")).toBeEmpty()
})

story("unmounts cleanly and starts a fresh editing session on remount", async ({ mount, page }) => {
  const errors: Error[] = []
  page.on("pageerror", (error) => errors.push(error))
  const root = await mount("components-file-editor--default", { args: { empty: true } })
  const editor = root.getByRole("textbox", { name: "src/greeting.ts" })
  await editor.click()
  await expect(root.locator("[data-caret]")).toBeAttached()
  await page.keyboard.type("draft")
  await expect(root.getByTestId("editor-contents")).toHaveText("draft")
  await root.getByRole("button", { name: "Unmount editor" }).click()
  await expect(root.locator("diffs-container")).toHaveCount(0)
  await root.getByRole("button", { name: "Mount editor" }).click()
  await expect(editor).toHaveText("")
  await editor.click()
  await expect(root.locator("[data-caret]")).toBeAttached()
  await page.keyboard.type("fresh")
  await expect(root.getByTestId("editor-contents")).toHaveText("fresh")
  await expect(root.getByTestId("editor-error")).toBeEmpty()
  expect(errors).toEqual([])
})

story("ignores a lazy editor import that resolves after unmount", async ({ mount, page }) => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const loaded = Promise.withResolvers<void>()
  await page.route(/(?:@pierre_diffs_edit|\/diffs\/dist\/edit\/index)\.js(?:\?|$)/, async (route) => {
    requested.resolve()
    await release.promise
    await route.continue()
    loaded.resolve()
  })
  const root = await mount("components-file-editor--default")
  await requested.promise
  const detached = await root.locator('[data-component="file-editor"]').elementHandle()
  await root.getByRole("button", { name: "Unmount editor" }).click()
  release.resolve()
  await loaded.promise
  await expect(root.locator("diffs-container")).toHaveCount(0)
  await root.getByRole("button", { name: "Mount editor" }).click()
  await expect(root.getByRole("textbox", { name: "src/greeting.ts" })).toBeVisible()
  await expect(root.locator("diffs-container")).toHaveCount(1)
  expect(await detached?.evaluate((node) => node.childElementCount)).toBe(0)
  await expect(root.getByTestId("editor-changes")).toHaveText("Changes: 0")
  await expect(root.getByTestId("editor-error")).toBeEmpty()
})

story("virtualizes large files and edits the final line with Ctrl+End", async ({ mount, page }) => {
  const root = await mount("components-file-editor--large")
  const editor = root.getByRole("textbox", { name: "src/large.ts" })
  await expect(editor).toBeVisible()
  expect(Number(await root.getByTestId("editor-size").textContent())).toBeGreaterThan(500_000)
  await expect.poll(() => editor.locator("[data-line]").count()).toBeLessThan(300)
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+End")
  await expect(editor.locator('[data-line="8001"]')).toBeVisible()
  await page.keyboard.type(" // edited")
  await expect(root.getByTestId("editor-contents")).toContainText('export const finalLine = "end" // edited')
  await page.keyboard.press("ControlOrMeta+Home")
  await expect(editor.locator('[data-line="1"]')).toBeVisible()
  await page.keyboard.press("ControlOrMeta+End")
  await expect(editor.locator('[data-line="8001"] [data-char]').filter({ hasText: "export" })).not.toHaveCSS(
    "color",
    /rgba\(0, 0, 0, 0\./,
  )
  await expect.poll(() => editor.locator("[data-line]").count()).toBeLessThan(300)
  await expect(root.getByTestId("editor-error")).toBeEmpty()
  await root.getByRole("button", { name: "Unmount editor" }).click()
  await expect(root.locator("diffs-container")).toHaveCount(0)
  await root.getByRole("button", { name: "Mount editor" }).click()
  await expect(editor).toBeVisible()
  await expect.poll(() => editor.locator("[data-line]").count()).toBeLessThan(300)
})
