import { expect, story } from "../../stories/playwright/story"

for (const control of ["text-input", "textarea"]) {
  story(`${control} supports its surfaces with inset feedback and stable geometry`, async ({ mount, page }) => {
    const root = await mount(`ui-${control}--surfaces`)

    const fields = root.locator(`[data-component="${control}-v2"]`)

    await page.addStyleTag({
      content: `[data-component="${control}-v2"] {
        --v2-background-bg-base: rgb(20, 30, 40);
        --v2-background-bg-layer-01: rgb(50, 60, 70);
        --v2-overlay-simple-overlay-hover: rgba(10, 20, 30, 0.1);
        --v2-elevation-input: 0px 0px 0px 3px rgb(1, 2, 3);
        --v2-elevation-button-neutral: 0px 0px 0px 7px rgb(4, 5, 6);
      }`,
    })

    await expect(fields.nth(0)).toHaveCSS("background-color", "rgb(20, 30, 40)")
    await expect(fields.nth(1)).toHaveCSS("background-color", "rgb(50, 60, 70)")
    await expect(fields.nth(0)).toHaveCSS("box-shadow", "rgb(1, 2, 3) 0px 0px 0px 3px")
    await expect(fields.nth(1)).toHaveCSS("box-shadow", "rgb(1, 2, 3) 0px 0px 0px 3px")

    for (const field of await fields.all()) {
      await expect(field).toHaveCSS("background-image", "none")
    }

    const base = fields.nth(0)

    const geometry = await base.getByRole("textbox").boundingBox()

    await base.hover()
    await expect
      .poll(() => base.evaluate((element) => getComputedStyle(element).boxShadow))
      .toContain("rgb(1, 2, 3) 0px 0px 0px 3px")
    await base.getByRole("textbox").fill("Still editable")
    await expect(base.getByRole("textbox")).toHaveValue("Still editable")
    await expect(base).toHaveCSS("outline-width", "1px")
    await expect(base).toHaveCSS("outline-offset", "-1px")
    await expect(base).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)")
    expect(await base.getByRole("textbox").boundingBox()).toEqual(geometry)

    const invalid = root.locator("[data-invalid]")

    const disabled = root.locator("[data-disabled]")

    await expect(invalid).toHaveCSS("outline-width", "1px")
    await expect(invalid).toHaveCSS("outline-offset", "-1px")
    await expect(invalid).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)")
    await expect(invalid.getByRole("textbox")).toHaveAttribute("aria-invalid", "true")
    await expect(disabled.getByRole("textbox")).toBeDisabled()

    if (control === "textarea") return

    const invisible = root.locator('[data-surface="invisible"]').first()

    await base.getByRole("textbox").blur()
    await expect(invisible).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await invisible.hover()
    await expect(invisible).toHaveCSS("background-color", "rgba(10, 20, 30, 0.1)")
    await expect(invisible).toHaveCSS("box-shadow", "none")
    await invisible.getByRole("textbox").focus()
    await expect(invisible).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(invisible).toHaveCSS("outline-offset", "-1px")
    await expect(invisible).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)")
    await expect(invalid).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(disabled).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(disabled).toHaveCSS("box-shadow", "none")
  })
}

story(
  "text inputs keep clear and copy actions equally sized and inset across sizes and directions",
  async ({ mount, page }) => {
    const root = await mount("ui-text-input--appearances")

    const fields = root.locator('[data-component="text-input-v2"]')

    for (const [index, height] of [24, 28, 32, 32, 24, 28, 32].entries()) {
      await expect(fields.nth(index)).toHaveCSS("height", `${height}px`)
    }

    for (const direction of ["ltr", "rtl"]) {
      await page.evaluate((dir) => (document.documentElement.dir = dir), direction)

      for (const field of await fields.filter({ has: page.getByRole("button") }).all()) {
        const button = field.getByRole("button")

        await expect(button).toHaveCSS("width", "20px")
        await expect(button).toHaveCSS("height", "20px")
        await expect(button).toHaveCSS("padding", "2px")
        await expect(button).toHaveCSS("border-radius", "4px")

        expect(
          await field.evaluate((element) => {
            const bounds = element.getBoundingClientRect()

            const action = element.querySelector("button")!.getBoundingClientRect()

            return {
              inset:
                getComputedStyle(element).direction === "rtl" ? action.left - bounds.left : bounds.right - action.right,
              center: action.y + action.height / 2 - bounds.y - bounds.height / 2,
            }
          }),
        ).toEqual({ inset: 8, center: 0 })
      }
    }
  },
)
