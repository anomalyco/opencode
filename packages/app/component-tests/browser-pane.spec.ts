import { expect, sourceURL, story } from "../../storybook/playwright/story"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-extensions/src/browser/panel.fixture.tsx"),
  embeds: source("../src/runtime/extension/embeds.tsx"),
  language: source("../src/runtime/i18n/language.tsx"),
}

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app styles; the fixture mounts the pane beside it on the real host embeds.
  await mount("ui-line-comment--editor")
  await page.evaluate(async (modules) => {
    const [{ mountBrowserPane }, { createEmbeds }, language] = await Promise.all([
      import(modules.fixture),
      import(modules.embeds),
      import(modules.language),
    ])

    mountBrowserPane({
      createEmbeds,
      LanguageProvider: language.LanguageProvider,
      UiI18nBridge: language.UiI18nBridge,
      useLanguage: language.useLanguage,
    })
  }, modules)
  await expect(page.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("hides a native page when another takes the pane, the pane hides, or it unmounts", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const alpha = root.getByTestId("native-Alpha")
  const beta = root.getByTestId("native-Beta")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(beta).toHaveAttribute("data-visible", "true")
  await expect(alpha).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Empty", exact: true }).click()
  await expect(root.locator("#browser-panel")).toHaveCount(0)
  await expect(beta).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(alpha).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Toggle Review tab", exact: true }).click()
  await expect(alpha).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Toggle Review tab", exact: true }).click()
  await expect(alpha).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Unmount pane", exact: true }).click()
  await expect(alpha).toHaveAttribute("data-visible", "false")
})

story("hides the native view immediately while the pane stays mounted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const toggle = root.getByRole("button", { name: "Toggle Review tab", exact: true })
  await expect(toggle).toBeEnabled()

  // Read in the same task as the click so a deferred animation-frame hide cannot pass.
  const visible = await toggle.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    return document.querySelector('[data-testid="native-Alpha"]')?.getAttribute("data-visible")
  })

  expect(visible).toBe("false")
  await expect(root.locator("#browser-panel")).toHaveCount(1)
  await toggle.click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("keeps a still of the page under floating content that covers it", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const still = root.locator("#browser-panel img")
  const native = root.getByTestId("native-Alpha")
  await root.getByRole("button", { name: "Hold capture", exact: true }).click()
  await root.getByRole("button", { name: "Toggle popover", exact: true }).click()
  await expect(root.getByText("Captures: 1", { exact: true })).toBeVisible()
  // The native page stays up until its still is ready, so the pane never shows blank.
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)

  // Main hides the native page at once, so the pane hides it only after a frame has presented the still.
  const order = await native.evaluateHandle((element) => {
    const events: string[] = []
    new PerformanceObserver((list) => {
      if (list.getEntries().length > 0) events.push("still presented")
    }).observe({ type: "element" })
    new MutationObserver(() => {
      if (element.getAttribute("data-visible") === "false") events.push("page hidden")
    }).observe(element, { attributeFilter: ["data-visible"] })

    return events
  })

  await root.getByRole("button", { name: "Release capture", exact: true }).click()
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(still).toBeVisible()
  expect(await order.jsonValue()).toEqual(["still presented", "page hidden"])

  await root.getByRole("button", { name: "Toggle popover", exact: true }).click()
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)
  await expect(root.getByText("Captures: 1", { exact: true })).toBeVisible()
})

story("comments on a picked element over a still of the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  await picker.click()
  await expect(picker).toHaveAttribute("aria-pressed", "true")
  await expect(root.getByText("Picker: on", { exact: true })).toBeVisible()
  await expect(root.getByText("Session getter reads: 0", { exact: true })).toBeVisible()
  await expect(root.getByRole("status")).toHaveText(
    "Click an element in the page to comment on it. Press Escape to cancel.",
  )

  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(picker).toHaveAttribute("aria-pressed", "false")
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await expect(editor).toBeFocused()
  await expect(root.getByText("Session getter reads: 0", { exact: true })).toBeVisible()
  await expect(root.locator('[data-slot="browser-comment-editor"]')).toContainText("button.primary")
  // The spotlight frames the picked element in surface pixels.
  await expect(root.locator('[data-slot="browser-comment-spotlight"]')).toHaveCSS("left", "48px")
  // The native page hides behind its still so the editor can float over it.
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.locator("#browser-panel img")).toBeVisible()

  await editor.fill("Make this the primary colour")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments")).toHaveText("button.primary @e7: Make this the primary colour")
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(0)
  await expect(root.getByText("Highlights: clear", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")

  // The pane stays mounted when Beta is routed, and its picker then listens to Beta's page.
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await picker.click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(editor).toBeFocused()
  await editor.fill("Beta's button too")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments").getByRole("listitem")).toHaveText([
    "button.primary @e7: Make this the primary colour",
    "button.primary @e7: Beta's button too",
  ])
})

story("cancels the picker and a comment with Escape", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  await picker.click()
  await expect(picker).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  await expect(picker).toHaveAttribute("aria-pressed", "false")
  await expect(root.getByText("Picker: off", { exact: true })).toBeVisible()

  await picker.click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await expect(editor).toBeFocused()
  await editor.press("Escape")
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(0)
  await expect(root.getByTestId("fixture-comments")).toHaveText("")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("cleans up the originating session's picker and comment after a session switch", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  await picker.click()
  await expect(root.getByText("Picker Alpha: on", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await expect(root.getByText("Picker Alpha: off", { exact: true })).toBeVisible()
  await expect(picker).toHaveAttribute("aria-pressed", "false")

  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await picker.click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(root.locator('[data-slot="browser-comment-editor"] textarea')).toBeFocused()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(0)
  await expect(root.getByText("Highlights: clear", { exact: true })).toBeVisible()
  await expect(root.getByText("Highlight owners: Alpha", { exact: true })).toBeVisible()
})

story("ends the native picker and highlight when the pane unmounts", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  await picker.click()
  await expect(root.getByText("Picker: on", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Unmount pane", exact: true }).click()
  await expect(root.locator("#browser-panel")).toHaveCount(0)
  await expect(root.getByText("Picker: off", { exact: true })).toBeVisible()

  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await picker.click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(root.locator('[data-slot="browser-comment-editor"] textarea')).toBeFocused()
  await root.getByRole("button", { name: "Unmount pane", exact: true }).click()
  await expect(root.locator("#browser-panel")).toHaveCount(0)
  await expect(root.getByText("Highlights: clear", { exact: true })).toBeVisible()
})

story("keeps a comment draft but drops its ref when the page navigates", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Select an element to comment on", exact: true }).click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await editor.fill("Still misaligned after the reload")
  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(editor).toHaveValue("Still misaligned after the reload")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments")).toHaveText(
    "button.primary (no ref): Still misaligned after the reload",
  )
})

story("keeps the comment editor and its actions inside the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Select an element to comment on", exact: true }).click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  const editor = root.locator('[data-slot="browser-comment-editor"]')
  // As if the user dragged the textarea's resize handle far past the page.
  await editor.locator("textarea").evaluate((element) => {
    element.style.height = "900px"
  })
  // The editor moves once it has measured its new height.
  await expect
    .poll(async () => {
      const surface = await root.locator('[data-component="browser-comment"]').boundingBox()
      const box = await editor.boundingBox()

      return !!surface && !!box && box.y + box.height <= surface.y + surface.height
    })
    .toBe(true)
  const submit = editor.getByRole("button", { name: "Comment", exact: true })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
})

story("shows the empty state over a blank native page and restores navigation", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await expect(root.getByText("Preview your app, read docs, or browse the web.", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeDisabled()

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(root.getByText("Open a page", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeEnabled()
})

story("keeps Stop available and hides the empty state while a blank page loads", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Loading page", exact: true }).click()
  await expect(root.getByText("Open a page", { exact: true })).toBeHidden()
  await root.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

story("keeps the submitted URL visible until the browser reports navigation", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("https://example.com/")
  await expect(root.getByText("Open a page", { exact: true })).toBeHidden()

  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(address).toHaveValue("https://example.com/")

  await address.fill("https://unsubmitted.example/")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  await expect(address).toHaveValue("https://example.com/")
})

story("restores the current URL each time the same submitted navigation is blocked", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })

  for (const submission of [1, 2]) {
    await story.step(`blocked submission ${submission}`, async () => {
      await address.fill("https://blocked.example/")
      await address.press("Enter")
      await expect(address).toHaveValue("https://blocked.example/")
      await root.getByRole("button", { name: "Block navigation", exact: true }).click()
      await expect(root.getByRole("alert")).toHaveText("Only web pages can open here.")
      await expect(address).toHaveValue("https://alpha.example/")
      await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
    })
  }
})

story("explains why a typed address cannot open instead of searching for it", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })

  for (const [typed, reason] of [
    ["ftp://example.com", "Only web pages can open here."],
    ["https://user:pass@example.com", "Addresses with a user name or password can't open here."],
  ]) {
    await address.fill(typed)
    await address.press("Enter")
    await expect(root.getByRole("alert")).toHaveText(reason)
    await expect(address).toHaveValue("https://alpha.example/")
  }
})

story("shows a themed failure state for only the failed tab and allows retry", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()
  await expect(root.getByText("Check the URL and your connection, then try again.", { exact: true })).toBeVisible()
  await expect(root.getByText("Request failed", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByRole("combobox", { name: "Browser address", exact: true })).toHaveValue(
    "https://alpha.example/",
  )

  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()

  await root.getByRole("button", { name: "Reload", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("returns a failed tab to the empty state when an empty URL is submitted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("")
  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeDisabled()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

story("selects the full URL when the address field gains focus", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://alpha.example/".length)
  await address.pressSequentially("https://example.com/")
  await expect(address).toHaveValue("https://example.com/")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await address.focus()
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://example.com/".length)
  // A click on the focused field places the caret instead of selecting the URL again.
  await address.press("ArrowRight")
  await address.click()
  await expect
    .poll(() => address.evaluate((input: HTMLInputElement) => input.selectionStart === input.selectionEnd))
    .toBe(true)
})

story("draws only the address at rest when focus leaves the window with the field selected", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  // Chromium blurs the field when the window or the native page takes focus, and the field keeps its full selection.
  await address.evaluate((input: HTMLInputElement) => {
    input.dispatchEvent(new FocusEvent("blur"))
    input.select()
  })
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://alpha.example/".length)
  await page.mouse.move(0, 0)

  // Computed ::selection styles do not report the default highlight, so compare the input's own paint with the
  // selection collapsed. The drawn address is hidden: a selection layer can change how its text is antialiased.
  await page.addStyleTag({ content: '[data-slot="browser-address-display"] { visibility: hidden }' })
  const field = root.locator('[data-component="browser-address"]')
  const selected = (await field.screenshot()).toString("base64")
  await address.evaluate((input: HTMLInputElement) => input.setSelectionRange(0, 0))
  const collapsed = (await field.screenshot()).toString("base64")

  const changed = await page.evaluate(
    async (shots) => {
      const pixels = await Promise.all(
        shots.map(async (data) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const canvas = new OffscreenCanvas(image.width, image.height)
          canvas.getContext("2d")?.drawImage(image, 0, 0)

          return canvas.getContext("2d")?.getImageData(0, 0, image.width, image.height).data ?? new Uint8ClampedArray()
        }),
      )

      return Array.from({ length: (pixels[0]?.length ?? 0) / 4 }, (_, index) => index * 4).filter((offset) =>
        [0, 1, 2].some((channel) => pixels[0]?.[offset + channel] !== pixels[1]?.[offset + channel]),
      ).length
    },
    [selected, collapsed],
  )

  expect(changed).toBe(0)
})

story("keeps the current page visible while a submitted URL loads", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await address.press("Enter")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(address).toHaveValue("https://example.com/")

  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(address).toHaveValue("https://example.com/")
})

story("keeps the current page and restores its URL when an empty address is submitted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("https://alpha.example/")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByText("Open a page", { exact: true })).toBeHidden()
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeEnabled()
})

story("suggests visited pages and opens the first one that completes the typed address", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed history", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await address.pressSequentially("localhost")
  const options = page.getByRole("option")
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  // Arrow keys that pick IME candidates leave the suggestions alone.
  await address.dispatchEvent("keydown", { key: "ArrowDown", isComposing: true })
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await address.press("Enter")
  await expect(address).toHaveValue("http://localhost:5173/settings")

  // A search query also opens the first match; stepping past the list leaves the typed text, which searches.
  await address.click()
  await address.pressSequentially("color format")
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await address.press("ArrowDown")
  await expect(options.first()).toHaveAttribute("aria-selected", "false")
  await address.press("Enter")
  await expect(address).toHaveValue("https://www.google.com/search?q=color%20format")
})

story("lists recent pages on a blank tab and opens one", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await root.getByRole("button", { name: "Seed history", exact: true }).click()
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await expect(root.getByText("Recent", { exact: true })).toBeVisible()
  // The globe at the field's start belongs to the field: a click there focuses it.
  await expect(address).not.toBeFocused()
  await root.locator('[data-component="browser-address"]').click({ position: { x: 16, y: 14 } })
  await expect(address).toBeFocused()
  await address.blur()

  await root.getByRole("button", { name: /^Settings - Preview/ }).click()
  await expect(address).toHaveValue("http://localhost:5173/settings")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  // The opened page owns the field afterwards: an edit that is never submitted shows its URL again.
  await address.click()
  await address.fill("unsubmitted")
  await address.blur()
  await expect(address).toHaveValue("http://localhost:5173/settings")
})

story("adds the whole page to the session and keeps the draft when the button is pressed again", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const field = root.locator('[data-component="browser-address"]')
  const add = root.getByRole("button", { name: "Add page to session", exact: true })
  await field.hover()
  await add.click()
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await editor.fill("Check the header layout")
  await field.hover()
  await add.click()
  await expect(editor).toHaveValue("Check the header layout")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments").getByRole("listitem")).toHaveText([/: Check the header layout$/])
})

story("focuses the address field when the page uses the address shortcut", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Address shortcut", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await expect(address).toBeFocused()
  await expect(address).toHaveJSProperty("selectionEnd", "https://alpha.example/".length)
})

story("shows the page's cookies in the site information and clears them", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  await expect(site).toContainText("3 cookies in use")
  await site.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(site).toContainText("0 cookies in use")
})

story("zooms the page from the browser options in view and keeps its zoom in the address field", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const options = root.getByRole("button", { name: "Browser options", exact: true })
  await options.click()
  await page.getByRole("menuitem", { name: /^Zoom in/ }).click()
  await expect(root.getByText("Zoom: 110", { exact: true })).toBeVisible()
  // The menu covered the page with a still; it closes so the zoomed page shows at once.
  await expect(page.getByRole("menu")).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")

  const zoom = root.getByRole("button", { name: "110%", exact: true })
  await expect(zoom).toBeVisible()
  await options.click()
  await expect(page.getByRole("menuitem", { name: /^Reset zoom/ })).toContainText("110%")
  await page.keyboard.press("Escape")
  await zoom.click()
  await expect(root.getByText("Zoom: 100", { exact: true })).toBeVisible()
  await expect(zoom).toBeHidden()
})

story("shows the agent's handoff above the page and sends the user's answer", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const handoff = root.locator('[data-component="browser-handoff"]')
  await root.getByRole("button", { name: "Agent handoff", exact: true }).click()
  await expect(handoff).toContainText("The agent needs you")
  await expect(handoff).toContainText("Sign in with the test account, then press Done.")

  // The native page is drawn above the DOM, so the request sits above the page's box instead of under it.
  const bar = await handoff.boundingBox()
  const box = await root.locator("#browser-panel [data-component='browser-handoff'] ~ *").first().boundingBox()
  expect(bar && box && box.y >= bar.y + bar.height - 1).toBe(true)

  await handoff.getByRole("button", { name: "Done", exact: true }).click()
  await expect(root.getByText("Handoff answers: req_1 done", { exact: true })).toBeVisible()
  await expect(handoff).toHaveCount(0)

  // A handoff that ends without the user (timeout, cancel) leaves without an answer.
  await root.getByRole("button", { name: "Agent handoff", exact: true }).click()
  await expect(handoff).toBeVisible()
  await root.getByRole("button", { name: "End handoff", exact: true }).click()
  await expect(handoff).toHaveCount(0)
  await expect(root.getByText("Handoff answers: req_1 done", { exact: true })).toBeVisible()
})
