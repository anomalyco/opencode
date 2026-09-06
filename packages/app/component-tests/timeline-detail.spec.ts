import { expect, story } from "../../storybook/playwright/story"

story("maps grouped and collapsed switches to the timeline settings", async ({ mount }) => {
  const component = await mount("settings-timeline-detail--interactive")
  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const shell = component.getByRole("group", { name: "Shell", exact: true })
  const grouped = shell.getByRole("switch", { name: "Shell grouped", exact: true })
  const collapsed = shell.getByRole("switch", { name: "Shell collapsed", exact: true })
  const value = component.locator('[data-slot="timeline-detail-fixture-value"]')

  await expect(component.getByRole("switch")).toHaveCount(9)
  await expect(component.getByText("Activity", { exact: true })).toHaveCount(0)
  await expect(grouped).toBeChecked()
  await expect(collapsed).toBeChecked()
  await shell.locator('[data-field="placement"] [data-slot="switch-control"]').click()
  await shell.locator('[data-field="details"] [data-slot="switch-control"]').click()
  await expect(value).toContainText('"shell":{"placement":"separate","details":"expanded"}')
  await grouped.focus()
  await grouped.press("Space")
  await collapsed.focus()
  await collapsed.press("Space")
  await expect(value).toContainText('"shell":{"placement":"grouped","details":"collapsed"}')
  await expect(component.getByRole("group", { name: "Subagents", exact: true }).getByRole("switch")).toHaveCount(1)
})

story("replaces hidden switches with solid lines and restores options", async ({ mount, page }) => {
  const component = await mount("settings-timeline-detail--interactive")
  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const shell = component.getByRole("group", { name: "Shell", exact: true })
  const visibility = shell.getByRole("button", { name: "Shell visibility" })
  const label = shell.locator('[data-slot="timeline-detail-activity"] > label')
  const color = await label.evaluate((element) => getComputedStyle(element).color)
  const iconColor = await visibility.evaluate((element) => getComputedStyle(element).color)
  await shell.locator('[data-field="placement"] [data-slot="switch-control"]').click()
  await shell.locator('[data-field="details"] [data-slot="switch-control"]').click()
  await visibility.hover()
  await expect(page.getByRole("tooltip")).toHaveText("Hide")
  expect(await page.getByRole("tooltip").evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(
    await visibility.evaluate((element) => element.getBoundingClientRect().top),
  )
  await visibility.click()

  await expect(visibility).toHaveAttribute("aria-pressed", "false")
  await expect(shell.getByRole("switch")).toHaveCount(0)
  await expect(shell.locator('[data-slot="timeline-detail-unavailable"]')).toHaveCount(2)
  await expect(shell.locator('[data-slot="timeline-detail-unavailable"]').first()).toHaveCSS(
    "border-top-style",
    "solid",
  )
  await expect(component.locator('[data-slot="timeline-detail-fixture-value"]')).toContainText(
    '"shell":{"placement":"hidden","details":"expanded"}',
  )
  await expect(label).not.toHaveCSS("color", color)
  await expect(shell.locator('[data-slot="timeline-detail-eye-slash"]')).toHaveCount(1)
  await component.getByRole("button", { name: "Advanced", exact: true }).hover()
  await expect(visibility).not.toHaveCSS("color", iconColor)
  await expect(shell.locator('[data-slot="timeline-detail-unavailable"]').first()).toHaveCSS(
    "border-top-color",
    await visibility.evaluate((element) => getComputedStyle(element).color),
  )
  await visibility.hover()
  await expect(page.getByRole("tooltip")).toHaveText("Show")
  expect(await page.getByRole("tooltip").evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(
    await visibility.evaluate((element) => element.getBoundingClientRect().top),
  )
  await visibility.click()

  await expect(visibility).toHaveAttribute("aria-pressed", "true")
  await expect(label).toHaveCSS("color", color)
  await expect(shell.locator('[data-slot="timeline-detail-eye-slash"]')).toHaveCount(0)
  await expect(shell.locator('[data-slot="timeline-detail-unavailable"]')).toHaveCount(0)
  await expect(shell.getByRole("switch", { name: "Shell grouped", exact: true })).toBeEnabled()
  await expect(shell.getByRole("switch", { name: "Shell collapsed", exact: true })).toBeEnabled()
  await expect(shell.getByRole("switch", { name: "Shell grouped", exact: true })).not.toBeChecked()
  await expect(shell.getByRole("switch", { name: "Shell collapsed", exact: true })).not.toBeChecked()
})

story("toggles visibility by clicking the activity label", async ({ mount }) => {
  const component = await mount("settings-timeline-detail--interactive")
  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const shell = component.getByRole("group", { name: "Shell", exact: true })
  const label = shell.locator('[data-slot="timeline-detail-activity"] > label')
  const visibility = shell.getByRole("button", { name: "Shell visibility" })

  await expect(label).toHaveCSS("cursor", "default")
  await label.click()
  await expect(visibility).toHaveAttribute("aria-pressed", "false")
  await expect(shell.getByRole("switch")).toHaveCount(0)
  await expect(shell.locator('[data-slot="timeline-detail-unavailable"]')).toHaveCount(2)
  await label.click()
  await expect(visibility).toHaveAttribute("aria-pressed", "true")
  await expect(shell.getByRole("switch", { name: "Shell grouped", exact: true })).toBeChecked()
  await expect(shell.getByRole("switch", { name: "Shell collapsed", exact: true })).toBeChecked()
})

story("only highlights the eye when hovering the icon, not its activity label", async ({ mount }) => {
  const component = await mount("settings-timeline-detail--interactive")
  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const shell = component.getByRole("group", { name: "Shell", exact: true })
  const visibility = shell.getByRole("button", { name: "Shell visibility" })
  const label = shell.locator('[data-slot="timeline-detail-activity"] > label')

  for (const hidden of [false, true]) {
    if (hidden) await label.click()
    await visibility.hover()
    await expect(visibility).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await label.hover()
    await expect(visibility).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  }
})

story("opens advanced on returning to custom settings but not presets", async ({ mount }) => {
  const component = await mount("settings-timeline-detail--interactive")
  const advanced = component.getByRole("button", { name: "Advanced", exact: true })
  await expect(advanced).toHaveAttribute("aria-expanded", "false")
  await advanced.click()
  await component.locator('[data-category="shell"][data-field="placement"] [data-slot="switch-control"]').click()
  await expect(component.getByRole("slider")).toHaveAttribute("aria-valuetext", "Custom")
  await advanced.click()
  await expect(advanced).toHaveAttribute("aria-expanded", "false")
  await component.getByRole("button", { name: "Leave settings" }).click()
  await expect(advanced).toHaveCount(0)
  await component.getByRole("button", { name: "Return to settings" }).click()
  await expect(advanced).toHaveAttribute("aria-expanded", "true")
  await expect(component.getByRole("switch", { name: "Shell grouped", exact: true })).not.toBeChecked()

  await component.getByRole("slider").press("End")
  await expect(component.getByRole("slider")).toHaveAttribute("aria-valuetext", "Everything")
  await component.getByRole("button", { name: "Leave settings" }).click()
  await component.getByRole("button", { name: "Return to settings" }).click()
  await expect(advanced).toHaveAttribute("aria-expanded", "false")
})

story("keeps visibility and switches in sync with the preset slider", async ({ mount }) => {
  const component = await mount("settings-timeline-detail--interactive")
  await component.getByRole("button", { name: "Advanced", exact: true }).click()
  const slider = component.getByRole("slider", { name: "Timeline detail" })
  await slider.focus()
  await slider.press("Home")
  await expect(slider).toHaveAttribute("aria-valuetext", "Messages only")
  await expect(component.getByRole("switch")).toHaveCount(0)
  await expect(component.locator('[data-slot="timeline-detail-unavailable"]')).toHaveCount(9)
  await expect(component.locator('[data-action="timeline-detail-visibility"][aria-pressed="false"]')).toHaveCount(6)
  await component.getByRole("button", { name: "Shell visibility" }).click()
  await expect(component.getByRole("switch", { name: "Shell grouped", exact: true })).toBeChecked()
  await expect(slider).toHaveAttribute("aria-valuetext", "Custom")
  await slider.focus()
  await slider.press("End")
  await expect(slider).toHaveAttribute("aria-valuetext", "Everything")
  await expect(component.getByRole("switch")).toHaveCount(9)
  await expect(component.locator('[data-slot="timeline-detail-unavailable"]')).toHaveCount(0)
  await expect(component.locator('[data-action="timeline-detail-visibility"][aria-pressed="true"]')).toHaveCount(6)
  await expect(component.getByRole("switch", { checked: true })).toHaveCount(0)
})

for (const direction of ["ltr", "rtl"]) {
  for (const theme of ["light", "dark"]) {
    story(`fits narrow and wide layouts in ${direction}, ${theme}`, async ({ mount, page }, testInfo) => {
      await page.setViewportSize({ width: 900, height: 900 })
      const component = await mount("settings-timeline-detail--interactive", { globals: { direction, theme } })
      await expect(component.locator('[data-slot="timeline-detail-summary"]')).toHaveCSS(
        "color",
        await component
          .locator('[data-slot="settings-row-title"]')
          .evaluate((element) => getComputedStyle(element).color),
      )
      await component.getByRole("button", { name: "Advanced", exact: true }).click()
      const track = component.locator('[data-slot="timeline-detail-track"]')
      await expect(track).toHaveCSS(
        "--timeline-detail-track-background",
        await track.evaluate(
          (element, theme) =>
            getComputedStyle(element)
              .getPropertyValue(theme === "light" ? "--v2-background-bg-layer-04" : "--v2-background-bg-layer-03")
              .trim(),
          theme,
        ),
      )
      if (theme === "light") {
        await expect(track.locator("span").first()).toHaveCSS("background-image", "none")
        await expect(track).toHaveCSS(
          "--timeline-detail-marker-background",
          await track.evaluate((element) => getComputedStyle(element).getPropertyValue("--v2-grey-500").trim()),
        )
      }
      if (theme === "dark") {
        await expect(track.locator("span").first()).not.toHaveCSS("background-image", "none")
      }
      await page.screenshot({ path: testInfo.outputPath(`timeline-${theme}-${direction}.png`) })
      const list = component.locator('[data-slot="timeline-detail-list"]')
      await expect(component.locator('[data-slot="timeline-detail-categories"]')).toHaveCSS("margin-top", "0px")
      for (const [column, field] of [
        [2, "placement"],
        [3, "details"],
      ] as const) {
        const heading = await component
          .locator(`[data-slot="timeline-detail-columns"] > :nth-child(${column})`)
          .evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return rect.x + rect.width / 2
          })
        const toggle = await component
          .locator(`[data-category="shell"][data-field="${field}"] [data-slot="switch-control"]`)
          .evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return rect.x + rect.width / 2
          })
        expect(Math.abs(heading - toggle)).toBeLessThan(1)
      }
      await expect(component.locator('[data-slot="timeline-detail-activity"]').first()).toHaveCSS("gap", "12px")
      for (const width of [900, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(component.getByRole("switch", { name: "Shell grouped", exact: true })).toBeVisible()
        expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        const visibility = component.getByRole("button", { name: "Shell visibility" })
        await visibility.focus()
        await visibility.press("Space")
        await expect(visibility).toHaveAttribute("aria-pressed", "false")
        await expect(component.getByRole("switch", { name: "Shell grouped", exact: true })).toHaveCount(0)
        await expect(
          component
            .getByRole("group", { name: "Shell", exact: true })
            .locator('[data-slot="timeline-detail-unavailable"]'),
        ).toHaveCount(2)
        await visibility.press("Space")
        await expect(visibility).toHaveAttribute("aria-pressed", "true")

        const slider = component.getByRole("slider", { name: "Timeline detail" })
        const track = component.locator('[data-slot="timeline-detail-track"]')
        expect(await track.evaluate((element) => element.getBoundingClientRect().width)).toBe(
          await component
            .locator('[data-slot="timeline-detail-scale"]')
            .evaluate((element) => element.getBoundingClientRect().width),
        )
        await slider.focus()
        await slider.press("Home")
        for (const position of [0, 1, 2, 3, 4]) {
          if (position > 0) await slider.press("ArrowUp")
          await expect(track).toHaveCSS("--timeline-detail-progress", `${position * 25}%`)
          const fill = await track.evaluate((element) => {
            const style = getComputedStyle(element, "::before")
            return {
              fraction: parseFloat(style.width) / element.getBoundingClientRect().width,
              start: style.getPropertyValue("inset-inline-start"),
              color: style.backgroundColor,
              remainder: getComputedStyle(element).backgroundColor,
            }
          })
          expect(fill.fraction).toBeCloseTo(position / 4, 2)
          expect(fill.start).toBe("0px")
          expect(fill.color).not.toBe(fill.remainder)
          const marker = await track.locator("span").nth(position).boundingBox()
          const bounds = await track.boundingBox()
          expect(marker).not.toBeNull()
          expect(bounds).not.toBeNull()
          expect((marker!.x + marker!.width / 2 - bounds!.x) / bounds!.width).toBeCloseTo(
            direction === "rtl" ? 1 - position / 4 : position / 4,
            2,
          )
        }
      }
    })
  }
}
