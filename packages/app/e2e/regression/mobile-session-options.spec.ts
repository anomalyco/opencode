import { expect, test } from "@playwright/test"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"

for (const scheme of ["light", "dark"] as const) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`mobile session options are compact and readable in ${scheme} ${direction}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await mockStressTimeline(page)
      await page.addInitScript((scheme) => {
        localStorage.setItem("opencode-color-scheme", scheme)
        localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: "bottom" } }))
      }, scheme)
      await openWithDirection(page, sessionHref(fixture.targetID), direction)
      const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
      const more = tabs.getByRole("tab", { name: "More...", exact: true })
      await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Session")
      await more.click()
      const drawer = page.getByRole("dialog", { name: "More options", exact: true })
      await expect(drawer).toBeVisible()
      await expect(drawer).not.toHaveAttribute("data-transitioning")
      await expect(drawer.locator('[data-slot="mobile-panel-header"]')).toHaveCount(0)
      await expect(drawer.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
      await expect(drawer.getByRole("heading", { name: "More options", exact: true })).toHaveCSS("width", "1px")
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme)
      await expect
        .poll(() =>
          drawer.evaluate((element) => {
            const options = element.querySelector('[data-slot="session-mobile-view-options"]')!

            return getComputedStyle(options).backgroundColor !== getComputedStyle(element).backgroundColor
          }),
        )
        .toBe(true)
      await drawer.screenshot({ path: testInfo.outputPath("options.png") })
      await testInfo.attach("options", { path: testInfo.outputPath("options.png"), contentType: "image/png" })

      for (const name of ["Files", "Terminal", "Usage", "Session details"]) {
        const option = drawer.getByRole("button", { name, exact: true })
        await expect(option).toHaveCSS("height", "44px")
        await expect
          .poll(() =>
            option.evaluate((element) => {
              const context = document.createElement("canvas").getContext("2d")!

              function luminance(color: string) {
                context.clearRect(0, 0, 1, 1)
                context.fillStyle = color
                context.fillRect(0, 0, 1, 1)

                const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
                  .slice(0, 3)
                  .map((channel) => {
                    const value = channel / 255

                    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
                  })

                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
              }

              const text = luminance(getComputedStyle(element).color)
              const surface = luminance(getComputedStyle(element.parentElement!).backgroundColor)

              return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
            }),
          )
          .toBeGreaterThanOrEqual(4.5)
      }

      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
      await expect(more).toBeFocused()

      for (const dismissal of ["backdrop", "drag"] as const) {
        await more.click()
        await expect
          .poll(() => drawer.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
          .toBe(0)
        await expect(drawer).not.toHaveAttribute("data-transitioning")

        if (dismissal === "backdrop")
          await page.locator('[data-slot="mobile-drawer-overlay"]').click({ position: { x: 10, y: 10 } })

        if (dismissal === "drag") {
          const handle = await drawer.locator('[data-slot="mobile-drawer-handle"]').boundingBox()
          expect(handle).not.toBeNull()
          await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
          await page.mouse.down()
          await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 1)
          await page.mouse.move(handle!.x + handle!.width / 2, 843)
          await page.mouse.up()
        }

        await expect(drawer).toBeHidden()
        await expect(more).toBeFocused()
      }
    })
  }
}
