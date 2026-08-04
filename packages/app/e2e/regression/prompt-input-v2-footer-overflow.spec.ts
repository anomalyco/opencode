import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2FooterOverflow"
const projectID = "proj_prompt_input_v2_footer_overflow"
const sessionID = "ses_prompt_input_v2_footer_overflow"
const modelName = "A model name that is intentionally long for narrow footer layouts"
const variantName = "thinking-with-an-intentionally-long-label"
const profiles = [
  { name: "LTR narrow", locale: "en", width: 320, expectOverflow: true },
  { name: "RTL narrow", locale: "ar", width: 320, expectOverflow: true },
  { name: "LTR desktop", locale: "en", width: 1280, expectOverflow: false },
] as const

for (const profile of profiles) {
  test(`${profile.name} keeps the V2 prompt submit button clear of overflowing controls`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "prompt-input-v2-footer-overflow",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: {
              "long-model": {
                id: "long-model",
                name: modelName,
                limit: { context: 200_000 },
                variants: { [variantName]: {} },
              },
            },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "long-model" },
      },
      sessions: [
        {
          id: sessionID,
          slug: "prompt-input-v2-footer-overflow",
          projectID,
          directory,
          title: "Prompt input V2 footer overflow",
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
    })
    await page.addInitScript((value) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: value }))
    }, profile.locale)

    await page.setViewportSize({ width: profile.width, height: 800 })
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expect(page.locator("html")).toHaveAttribute("dir", profile.locale === "ar" ? "rtl" : "ltr")

    const composer = page.locator('[data-component="prompt-input-v2"]')
    const form = composer.locator('form[data-component="prompt-input-v2"]')
    const controls = composer.locator('[data-slot="prompt-input-controls"]')
    const input = composer.locator('[data-component="prompt-input"]')
    const model = composer.locator('[data-action="prompt-model"]')
    const submit = composer.locator('[data-action="prompt-submit"]')
    const variant = controls.locator('[data-action="prompt-variant"]')
    await expectAppVisible(composer)
    await expect(controls).toBeVisible()
    await expect(model).toContainText(modelName)
    await model.scrollIntoViewIfNeeded()
    await expect(variant).toBeVisible()
    await input.fill("keep the submit button clear")
    await expect(submit).toBeEnabled()

    await variant.click()
    await page.getByRole("menuitemradio", { name: variantName }).click()
    await expect(variant).toContainText(variantName)
    await variant.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "end" }))
    await variant.focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await expect(variant).toBeFocused()
    await submit.click({ trial: true })

    const layout = await form.evaluate((element) => {
      const controls = element.querySelector<HTMLElement>('[data-slot="prompt-input-controls"]')!
      const submit = element.querySelector<HTMLElement>('[data-action="prompt-submit"]')!
      const formBox = element.getBoundingClientRect()
      const controlsBox = controls.getBoundingClientRect()
      const submitBox = submit.getBoundingClientRect()
      const variant = controls.querySelector<HTMLElement>('[data-action="prompt-variant"]')!
      const variantBox = variant.getBoundingClientRect()
      const controlsStyle = getComputedStyle(controls)
      const variantStyle = getComputedStyle(variant)
      const focusExtent =
        Number.parseFloat(variantStyle.outlineWidth) + Number.parseFloat(variantStyle.outlineOffset)
      const logicalEndClearance =
        controlsStyle.direction === "rtl"
          ? variantBox.left - controlsBox.left
          : controlsBox.right - variantBox.right
      const overlap = Math.max(
        0,
        Math.min(controlsBox.right, submitBox.right) - Math.max(controlsBox.left, submitBox.left),
      )
      const target = document.elementFromPoint(
        submitBox.left + submitBox.width / 2,
        submitBox.top + submitBox.height / 2,
      )
      return {
        controlsOverflow: controls.scrollWidth > controls.clientWidth,
        controlsOverflowX: controlsStyle.overflowX,
        focusVisible: variant.matches(":focus-visible"),
        focusExtent,
        logicalEndClearance,
        focusOutlineInsideControls:
          variantBox.left - focusExtent >= controlsBox.left &&
          variantBox.right + focusExtent <= controlsBox.right &&
          variantBox.top - focusExtent >= controlsBox.top &&
          variantBox.bottom + focusExtent <= controlsBox.bottom,
        variantInsideControls:
          variantBox.left >= controlsBox.left &&
          variantBox.right <= controlsBox.right &&
          variantBox.top >= controlsBox.top &&
          variantBox.bottom <= controlsBox.bottom,
        submitInsideControls: controls.contains(submit),
        submitInsideForm:
          submitBox.left >= formBox.left &&
          submitBox.right <= formBox.right &&
          submitBox.top >= formBox.top &&
          submitBox.bottom <= formBox.bottom,
        submitOverlap: overlap,
        submitTarget: target instanceof Node && submit.contains(target),
      }
    })

    expect(layout.controlsOverflow).toBe(profile.expectOverflow)
    expect(layout.controlsOverflowX).toBe("auto")
    expect(layout.focusVisible).toBe(true)
    expect(layout.focusExtent).toBeGreaterThan(0)
    expect(layout.logicalEndClearance).toBeGreaterThanOrEqual(layout.focusExtent)
    expect(layout.focusOutlineInsideControls).toBe(true)
    expect(layout.variantInsideControls).toBe(true)
    expect(layout.submitInsideControls).toBe(false)
    expect(layout.submitInsideForm).toBe(true)
    expect(layout.submitOverlap).toBe(0)
    expect(layout.submitTarget).toBe(true)
  })
}
