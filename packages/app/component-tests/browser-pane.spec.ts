import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/panel.fixture.tsx"),
  embeds: source("../src/runtime/plugin/embeds.tsx"),
  links: source("../src/runtime/plugin/app-links.ts"),
  panelMotion: source("../src/shell/panel-motion.ts"),
  language: source("../src/runtime/i18n/language.tsx"),
}

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app styles; the fixture mounts the pane beside it on the real host embeds.
  await mount("ui-line-comment--editor")
  await mountPane(page)
  await expect(page.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

async function mountPane(page: Page) {
  await page.evaluate(async (modules) => {
    const [{ mountBrowserPane }, { createEmbeds }, { createAppLinks }, panelMotion, language] = await Promise.all([
      import(modules.fixture),
      import(modules.embeds),
      import(modules.links),
      import(modules.panelMotion),
      import(modules.language),
    ])

    mountBrowserPane({
      createEmbeds,
      createAppLinks,
      panelMotion,
      LanguageProvider: language.LanguageProvider,
      UiI18nBridge: language.UiI18nBridge,
      useLanguage: language.useLanguage,
    })
  }, modules)
}

story("reviews the actual application target only after a trusted click", async ({ page }) => {
  const sanitizer = sourceURL(new URL("../../session-ui/src/components/markdown-cache.tsx", import.meta.url))
  const url = "obsidian://open?vault=test&file=report"
  await page.evaluate(async ({ sanitizer, url }) => {
    const { enableMarkdownAppLinks, sanitizeMarkdown } = await import(sanitizer)
    const row = document.createElement("div")
    row.dataset.paneRow = ""
    row.innerHTML = sanitizeMarkdown(`<a href="${url}">Misleading title</a>`)
    enableMarkdownAppLinks(row)
    document.querySelector('[data-testid="browser-pane-fixture"]')?.prepend(row)
    row.querySelector("a")?.click()
  }, { sanitizer, url })
  const pane = page.locator("#browser-panel")
  await expect(pane.getByText(url)).toHaveCount(0)
  const link = page.getByRole("link", { name: "Misleading title" })
  await link.hover()
  await page.mouse.down()
  await link.evaluate((node) => node.replaceWith(node.cloneNode(true)))
  await page.mouse.up()
  await expect(pane.getByText(url)).toHaveCount(0)
  await link.click({ button: "middle" })
  await link.click({ modifiers: ["Shift"] })
  await link.hover()
  await page.mouse.down()
  await link.evaluate(node => { node.dataset.appLink = "obsidian:changed" })
  await page.mouse.up()
  await expect(pane.getByText("obsidian:changed")).toHaveCount(0)
  await expect(pane.getByRole("button", { name: "Open", exact: true })).toHaveCount(0)
  await link.evaluate((node, url) => { node.dataset.appLink = url }, url)
  await link.press("Enter")
  await expect(pane.getByRole("status").filter({ hasText: "From the conversation" })).toContainText(url)
  await expect(pane.getByRole("button", { name: "Open", exact: true })).toBeVisible()
  // A synthetic press on the guarded button cannot answer the review, even after a real Enter on the link.
  await pane.getByRole("button", { name: "Open", exact: true }).evaluate((button: HTMLElement) => button.click())
  await expect(pane.getByText(url)).toBeVisible()
  // A fresh notice reuses the bar but not the earlier notice's press or activation time.
  await link.click()
  const open = pane.getByRole("button", { name: "Open", exact: true })
  await open.click()
  await expect(pane.getByText(url)).toBeVisible()
  const longest = "obsidian://open?file=".padEnd(200, "W")
  await pane.evaluate(node => { node.style.width = "320px" })
  await link.evaluate((node, value) => { node.dataset.appLink = value }, longest)
  await link.press("Enter")
  await expect(pane.getByText(longest)).toBeVisible()
  await expect(open).toBeVisible()
  // A font or width that doesn't fit five lines downgrades the same notice without changing its target.
  await pane.evaluate(node => { node.style.width = "240px" })
  await expect(pane.getByRole("button", { name: "Copy link", exact: true })).toBeVisible()
  await expect(open).toHaveCount(0)
})

story("accepts an assistive activation of the focused link, not a synthetic or unfocused one", async ({ page }) => {
  const sanitizer = sourceURL(new URL("../../session-ui/src/components/markdown-cache.tsx", import.meta.url))
  // A mail link keeps its href, so Chromium activates it on Enter.
  const url = "mailto:assistive@example.invalid"
  await page.evaluate(async ({ sanitizer, url }) => {
    const { enableMarkdownAppLinks, sanitizeMarkdown } = await import(sanitizer)
    const row = document.createElement("div")
    row.dataset.paneRow = ""
    row.innerHTML = sanitizeMarkdown(`<a href="${url}">Assistive link</a> <a href="https://example.invalid/">Other</a>`)
    enableMarkdownAppLinks(row)
    document.querySelector('[data-testid="browser-pane-fixture"]')?.prepend(row)
    // A screen reader's default action is a trusted click with no press. Chromium sends the same one for Enter on a
    // live link when nothing handles the key, so keep the app's own Enter handling out of the way.
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || !document.body.dataset.assistive) return
        event.stopImmediatePropagation()

        if (document.body.dataset.assistive === "unfocused") row.querySelectorAll("a")[1]?.focus()
      },
      true,
    )
  }, { sanitizer, url })
  const pane = page.locator("#browser-panel")
  const link = page.getByRole("link", { name: "Assistive link" })
  await link.focus()
  await link.evaluate((node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })))
  await page.evaluate(() => { document.body.dataset.assistive = "unfocused" })
  await link.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("link", { name: "Other" })).toBeFocused()
  await expect(pane.getByText(url)).toHaveCount(0)
  await page.evaluate(() => { document.body.dataset.assistive = "focused" })
  await link.focus()
  await page.keyboard.press("Enter")
  await expect(pane.getByRole("status").filter({ hasText: "From the conversation" })).toContainText(url)
})

story("moves the native page when a fixed-size pane changes position", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  const x = Number(await native.getAttribute("data-x"))
  const calls = Number(await native.getAttribute("data-layout-calls"))
  await page.locator("#browser-panel").evaluate((pane) => {
    pane.style.translate = "-12px"
    pane.style.translate = "-24px"
    pane.style.translate = "-39px"
  })
  await expect(native).toHaveAttribute("data-x", String(x - 39))
  await expect(native).toHaveAttribute("data-layout-calls", String(calls + 1))
})

story("reconnects the observation spine after its panel reattaches", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  const x = Number(await native.getAttribute("data-x"))

  const detached = await page.locator("#browser-panel").evaluateHandle((box) => {
    const marker = document.createComment("panel slot")
    box.replaceWith(marker)
    const fragment = document.createDocumentFragment()
    fragment.append(box)

    return { marker, fragment }
  })

  await expect(native).toHaveAttribute("data-visible", "false")
  await detached.evaluate(({ marker, fragment }) => { marker.replaceWith(fragment) })
  await expect(native).toHaveAttribute("data-visible", "true")
  await page.locator("#browser-panel").evaluate((box) => { box.parentElement!.style.translate = "-31px" })
  await expect(native).toHaveAttribute("data-x", String(x - 31))
})

story("a spinner inside a persistent floating surface does not measure the pane each frame", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")

  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector('div.absolute.inset-0[aria-hidden="true"]')!.parentElement!
    const rect = box.getBoundingClientRect.bind(box)
    const count = { reads: 0 }
    box.getBoundingClientRect = () => {
      count.reads++

      return rect()
    }

    const surface = document.createElement("div")
    surface.dataset.floatingOverlay = ""
    const spinner = document.createElement("span")
    const style = document.createElement("style")
    style.textContent = "@keyframes fixture-spin { to { transform: rotate(1turn) } }"
    spinner.style.cssText = "display:block; animation:fixture-spin 100ms linear infinite"
    surface.append(style, spinner)
    document.body.append(surface)
    const cycle = () => new Promise<void>(resolve => spinner.addEventListener("animationiteration", () => resolve(), { once: true }))
    await cycle()
    const initial = count.reads
    await cycle()
    const total = count.reads - initial
    surface.remove()

    return total
  })

  expect(reads).toBe(0)
  await expect(native).toHaveAttribute("data-visible", "true")
})

story("stops measuring the pane once a finite animation ends or is cancelled", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  const x = Number(await native.getAttribute("data-x"))

  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector('div.absolute.inset-0[aria-hidden="true"]')!.parentElement!
    const rect = box.getBoundingClientRect.bind(box)
    const count = { reads: 0 }
    box.getBoundingClientRect = () => {
      count.reads++

      return rect()
    }

    const frames = (n: number) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve())
        step(n)
      })

    const idle = async () => {
      const before = count.reads
      await frames(10)

      return count.reads - before
    }

    const finished = panel.parentElement!.animate([{ translate: "0" }, { translate: "-20px" }], { duration: 120, fill: "forwards" })
    await finished.finished
    await frames(2)
    const afterFinish = await idle()
    const cancelled = panel.parentElement!.animate([{ translate: "-20px" }, { translate: "-60px" }], { duration: 5_000 })
    await frames(3)
    cancelled.cancel()
    await frames(2)
    const afterCancel = await idle()

    return { afterFinish, afterCancel, measured: count.reads > 0 }
  })

  expect(reads).toEqual({ afterFinish: 0, afterCancel: 0, measured: true })
  await expect(native).toHaveAttribute("data-x", String(x - 20))
})

story("does not measure when the pane's own still enters or leaves its box", async ({ page }) => {
  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector('div.absolute.inset-0[aria-hidden="true"]')!.parentElement!
    const rect = box.getBoundingClientRect.bind(box)
    const count = { reads: 0 }
    box.getBoundingClientRect = () => {
      count.reads++

      return rect()
    }

    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const still = document.createElement("div")
    still.className = "absolute inset-0 pointer-events-none"
    box.prepend(still)
    await frames()
    still.remove()
    await frames()

    return count.reads
  })

  expect(reads).toBe(0)
})

story("hides the page when a portalled surface grows over it by a text edit alone", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  await page.emulateMedia({ reducedMotion: "reduce" })

  const text = await page.locator("#browser-panel").evaluateHandle((panel) => {
    const pane = panel.querySelector('div.absolute.inset-0[aria-hidden="true"]')!.parentElement!.getBoundingClientRect()
    // A portal's wrapper keeps its size while the fixed surface inside it grows, as a toast region's does.
    const wrapper = document.createElement("div")
    const surface = document.createElement("div")
    surface.dataset.floatingOverlay = ""
    surface.style.cssText = `position:fixed; top:${pane.top + 8}px; left:${pane.left - 40}px; white-space:pre; font:16px monospace`
    const text = document.createTextNode("x")
    surface.append(text)
    wrapper.append(surface)
    document.body.append(wrapper)

    return text
  })

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(native).toHaveAttribute("data-visible", "true")
  await text.evaluate((node) => { node.data = "x".repeat(400) })
  await expect(native).toHaveAttribute("data-visible", "false")
})

story("covers the page with unmarked portalled surfaces but not tooltips or transparent wrappers", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")

  const portal = await page.locator("#browser-panel").evaluateHandle((panel) => {
    const pane = panel.querySelector('div.absolute.inset-0[aria-hidden="true"]')!.parentElement!.getBoundingClientRect()
    const box = `position:fixed; top:${pane.top + 8}px; left:${pane.left + 8}px; width:120px; height:60px`
    const tooltip = document.createElement("div")
    tooltip.innerHTML = `<div style="${box}" role="tooltip">Tip</div>`
    const wrapper = document.createElement("div")
    wrapper.style.cssText = "position:fixed; inset:0; pointer-events:none"
    document.body.append(tooltip, wrapper)
    const surface = document.createElement("div")
    surface.innerHTML = `<div style="${box}; background:Canvas; pointer-events:auto">Unmarked menu</div>`

    return { surface, wrapper }
  })

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(native).toHaveAttribute("data-visible", "true")
  await portal.evaluate(({ surface }) => document.body.append(surface))
  await expect(native).toHaveAttribute("data-visible", "false")
  await portal.evaluate(({ surface, wrapper }) => wrapper.append(surface.firstElementChild!))
  await expect(native).toHaveAttribute("data-visible", "false")
  await portal.evaluate(({ wrapper }) => wrapper.replaceChildren())
  await expect(native).toHaveAttribute("data-visible", "true")
})

story("covers the page with an app dialog's backdrop for as long as the backdrop is there", async ({ mount, page }) => {
  // The fixture reports no open dialog to the embeds, and the dialog was portalled before the pane: only the marked
  // backdrop itself covers the page, independent of the dialog stack's open state, which ends as the exit starts.
  await mount("ui-dialog--with-popups")
  await expect(page.getByRole("dialog", { name: "Popups" })).toBeVisible()
  await mountPane(page)
  const native = page.getByTestId("native-Alpha")
  await expect(native).toHaveAttribute("data-layout-calls", /[1-9]/)
  await expect(page.locator('[data-component="dialog-overlay"]')).toHaveCount(1)
  await expect(native).toHaveAttribute("data-visible", "false")
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-component="dialog-overlay"]')).toHaveCount(0)
  await expect(native).toHaveAttribute("data-visible", "true")
})

story("tracks a fixed-size pane through a sibling resize, ancestor scroll and animation", async ({ page }) => {
  const pane = page.locator("#browser-panel")
  const native = page.getByTestId("native-Alpha")
  const x = Number(await native.getAttribute("data-x"))

  const row = await pane.evaluateHandle((box) => {
    const scroller = document.createElement("div")
    const spacer = document.createElement("div")
    const rect = box.getBoundingClientRect()
    scroller.style.cssText = `display:flex; overflow:auto; width:${rect.width}px; height:${rect.height}px`
    box.style.flex = `0 0 ${rect.width}px`
    spacer.style.flex = "0 0 32px"
    box.replaceWith(scroller)
    scroller.append(spacer, box)

    return { spacer, scroller }
  })

  await expect(native).toHaveAttribute("data-x", String(x + 32))
  await row.evaluate(({ spacer }) => { spacer.style.flexBasis = "48px" })
  await expect(native).toHaveAttribute("data-x", String(x + 48))
  await row.evaluate(({ scroller }) => { scroller.scrollLeft = 19 })
  await expect(native).toHaveAttribute("data-x", String(x + 29))
  const motion = await row.evaluateHandle(({ scroller }) => scroller.animate([{ translate: "0" }, { translate: "-64px" }], { duration: 220, fill: "forwards" }))
  await motion.evaluate(animation => animation.finished.then(() => undefined))
  await expect(native).toHaveAttribute("data-x", String(x - 35))
  await motion.evaluate(animation => animation.cancel())
  await expect(native).toHaveAttribute("data-x", String(x + 29))
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

story("updates the selected match while the same find field stays focused", async ({ page }) => {
  const pane = page.locator("#browser-panel")
  await pane.getByRole("button", { name: "Browser options" }).click()
  await page.getByRole("menuitem", { name: "Find in page" }).click()
  const field = pane.getByRole("searchbox", { name: "Find in page" })
  await field.fill("landmark")
  const count = pane.getByRole("search").getByRole("status")
  await expect(count).toHaveText("1 of 3")
  await field.press("Enter")
  await expect(count).toHaveText("2 of 3")
  await expect(field).toBeFocused()
  await field.press("Escape")
  await expect(field).toHaveCount(0)
})

story("paints a still of the page in place of the native view while a panel moves", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const motion = root.getByRole("button", { name: "Toggle panel motion", exact: true })
  const pane = root.getByRole("button", { name: "Toggle Review tab", exact: true })
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")

  // Read in the same task as the click: a native view left up for even one frame floats over the moving app.
  const visible = await motion.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    return document.querySelector('[data-testid="native-Alpha"]')?.getAttribute("data-visible")
  })

  expect(visible).toBe("false")
  // A close: the page flies out as a still of itself rather than a blank box.
  await expect(still).toBeVisible()
  await pane.click()
  await expect(still).toBeVisible()
  await motion.click()
  await expect(still).toHaveCount(0)

  // An open shows the still the close left, until the flight lands and the page is back.
  await motion.click()
  await pane.click()
  await expect(still).toBeVisible()
  await expect(native).toHaveAttribute("data-visible", "false")
  await motion.click()
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)
})

story("paints a still of the page in place of the native view while a resize handle is dragged", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const handle = root.getByTestId("pane-resize-handle")
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")

  // A native view's bounds land on screen frames before the DOM around it, so one left up through a drag jumps against
  // its pane on every move. A click on the handle moves nothing and must not blink the page out. Read in the same task
  // as each event, so a view hidden and shown again before the next frame cannot pass.
  const visible = await handle.evaluate((element) => {
    const read = () => document.querySelector('[data-testid="native-Alpha"]')?.getAttribute("data-visible")
    const box = element.getBoundingClientRect()
    const at = { bubbles: true, pointerId: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
    element.dispatchEvent(new PointerEvent("pointerdown", { ...at, button: 0 }))
    document.dispatchEvent(new PointerEvent("pointerup", at))
    const click = read()
    element.dispatchEvent(new PointerEvent("pointerdown", { ...at, button: 0 }))
    const pressed = read()
    document.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX - 40 }))

    return { click, pressed, dragging: read() }
  })

  expect(visible).toEqual({ click: "true", pressed: "true", dragging: "false" })
  await expect(still).toBeVisible()
  await handle.evaluate((element) => {
    const box = element.getBoundingClientRect()
    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: box.x, clientY: box.y }),
    )
  })
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)
})

story("shows the native view again when the window loses focus mid-drag", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const handle = root.getByTestId("pane-resize-handle")
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")

  // Alt+Tab mid-drag delivers no pointerup; the page must not stay locked behind a still.
  await handle.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const at = { bubbles: true, pointerId: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
    element.dispatchEvent(new PointerEvent("pointerdown", { ...at, button: 0 }))
    document.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX - 40 }))
  })
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(handle).toHaveAttribute("data-dragging", "")

  await handle.evaluate(() => window.dispatchEvent(new FocusEvent("blur")))
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)
  await expect(handle).not.toHaveAttribute("data-dragging")
  expect(await handle.evaluate(() => document.body.style.userSelect)).toBe("")
})

story("never flies a still of a page the tab has navigated away from", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const motion = root.getByRole("button", { name: "Toggle panel motion", exact: true })
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")
  await motion.click()
  await expect(still).toBeVisible()
  await motion.click()
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)

  await root.getByRole("button", { name: "Hold capture", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await address.press("Enter")
  await expect(address).toHaveValue("https://example.com/")
  await expect(native).toHaveAttribute("data-visible", "true")
  await motion.click()
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(still).toHaveCount(0)
  // The new page's own still stands in once it arrives.
  await root.getByRole("button", { name: "Release capture", exact: true }).click()
  await expect(still).toBeVisible()
})

story("refreshes page stills by the window's focus, not the document's", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const captures = async () => Number((await root.getByText(/^Captures: \d+$/).textContent())?.split(": ")[1])
  await page.clock.install()
  await expect(root.getByText(/^Captures: [1-9]/)).toBeVisible()

  // Main reports the window unfocused while this document keeps focus: stills follow the window, so they stop.
  await root.getByRole("button", { name: "Blur window", exact: true }).click()
  const paused = await captures()
  await page.clock.runFor(120_000)
  expect(await captures()).toBe(paused)

  // Focus coming back to the window, even straight into the embed, which never focuses this document, takes a fresh
  // still at once.
  await root.getByRole("button", { name: "Focus window", exact: true }).click()
  await page.clock.runFor(10)
  await expect(root.getByText(`Captures: ${paused + 1}`, { exact: true })).toBeVisible()
})

story("keeps a still of the page under floating content that covers it", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const still = root.locator("#browser-panel img")
  const native = root.getByTestId("native-Alpha")
  // Reduced motion lands panels at once, so the pane keeps no flight still and captures only for the cover.
  await page.emulateMedia({ reducedMotion: "reduce" })
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

story("covers the page with its warm still only once the capture is back, and through the thaw", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const still = root.locator("#browser-panel img")
  const native = root.getByTestId("native-Alpha")
  const popover = root.getByRole("button", { name: "Toggle popover", exact: true })
  // Without reduced motion the pane keeps a still of the page for flights, which can cover the page at once.
  await expect(root.getByText(/^Captures: [1-9]/)).toBeVisible()
  const captures = Number((await root.getByText(/^Captures: \d+$/).textContent())?.split(": ")[1])
  await root.getByRole("button", { name: "Hold capture", exact: true }).click()
  await popover.click()
  await expect(root.getByText(`Captures: ${captures + 1}`, { exact: true })).toBeVisible()
  // Main captures only a visible view: hiding it while the capture is out returns no fresh still.
  await expect(still).toHaveCount(1)
  await expect(native).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Release capture", exact: true }).click()
  await expect(native).toHaveAttribute("data-visible", "false")
  await popover.click()
  await expect(native).toHaveAttribute("data-visible", "true")

  // A capture that returns nothing still leaves the warm still over the hidden page, and over the page while it
  // paints again after the cover ends.
  // The fixture's controls below the pane sit outside the viewport.
  await root.getByRole("button", { name: "Fail capture", exact: true }).evaluate((element: HTMLElement) => element.click())
  await popover.click()
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(still).toHaveCount(1)

  const frames = await popover.evaluate(async (button) => {
    const samples: [string | null, number][] = []

    const read = (): [string | null, number] => [
      document.querySelector('[data-testid="native-Alpha"]')?.getAttribute("data-visible") ?? null,
      document.querySelectorAll("#browser-panel img").length,
    ]

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise<void>((resolve) => {
      const step = () => {
        samples.push(read())

        if (samples.length < 60 && (samples.at(-1)?.[1] ?? 0) > 0) return requestAnimationFrame(step)
        resolve()
      }

      requestAnimationFrame(step)
    })

    return samples
  })

  expect(frames.filter(([visible, stills]) => visible === "false" && stills === 0)).toEqual([])
  expect(frames.some(([visible, stills]) => visible === "true" && stills > 0)).toBe(true)
  await expect(still).toHaveCount(0)
})

story(
  "freezes on the latest capture when floating content closes and reopens before a capture lands",
  async ({ page }) => {
    const root = page.getByTestId("browser-pane-fixture")
    const popover = root.getByRole("button", { name: "Toggle popover", exact: true })
    const still = root.locator("#browser-panel img")
    const native = root.getByTestId("native-Alpha")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await root.getByRole("button", { name: "Hold capture", exact: true }).click()
    await popover.click()
    await expect(root.getByText("Captures: 1", { exact: true })).toBeVisible()
    await popover.click()
    await expect(page.locator("[data-popper-positioner]")).toHaveCount(0)
    // The pane measures the overlap on the next animation frame; nothing on screen changes while the capture is held.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await popover.click()
    await expect(root.getByText("Captures: 2", { exact: true })).toBeVisible()

    // Both captures land in order; the first one belongs to the cover that already closed.
    await root.getByRole("button", { name: "Release capture", exact: true }).click()
    await expect(native).toHaveAttribute("data-visible", "false")
    await expect(still).toBeVisible()
    // The fixture draws each capture a pixel wider: the second one is 5 pixels wide.
    await expect(still).toHaveJSProperty("naturalWidth", 5)
  },
)

story("keeps a still of the page under an open dialog instead of blanking the pane", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const still = root.locator("#browser-panel img")
  const native = root.getByTestId("native-Alpha")
  const toggle = root.getByRole("button", { name: "Toggle dialog", exact: true })
  await root.getByRole("button", { name: "Hold capture", exact: true }).click()

  // Read in the same task as the click: the page must not hide before its still exists.
  const visible = await toggle.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    return document.querySelector('[data-testid="native-Alpha"]')?.getAttribute("data-visible")
  })

  expect(visible).toBe("true")
  await expect(root.getByText("Captures: 1", { exact: true })).toBeVisible()
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)

  await root.getByRole("button", { name: "Release capture", exact: true }).click()
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(still).toBeVisible()

  await toggle.click()
  await expect(native).toHaveAttribute("data-visible", "true")
  await expect(still).toHaveCount(0)
  await expect(root.getByText("Captures: 1", { exact: true })).toBeVisible()
})

story("hides the native page under a dialog even when its still never arrives", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const native = root.getByTestId("native-Alpha")
  const toggle = root.getByRole("button", { name: "Toggle dialog", exact: true })
  await page.clock.install()
  await root.getByRole("button", { name: "Hold capture", exact: true }).click()
  await toggle.click()
  await page.clock.runFor(100)
  await expect(native).toHaveAttribute("data-visible", "true")

  // The capture never settles: after its timeout the page hides over the box background instead of the dialog.
  await page.clock.runFor(5_000)
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(root.locator("#browser-panel img")).toHaveCount(0)

  await toggle.click()
  await page.clock.runFor(100)
  await expect(native).toHaveAttribute("data-visible", "true")
})

story("comments on a picked element over a still of the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("zoomed")
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
  await expect(editor).toHaveAttribute("placeholder", "Add an optional comment...")
  await expect(editor).toHaveAccessibleName("Comment on this element")
  await expect(root.getByText("Session getter reads: 0", { exact: true })).toBeVisible()
  await expect(root.locator('[data-slot="browser-comment-editor"]')).toContainText("button.primary")
  // The spotlight frames the picked element in surface pixels.
  await expect(root.locator('[data-slot="browser-comment-spotlight"]')).toHaveCSS("left", "38.4px")
  await expect(root.locator('[data-slot="browser-comment-spotlight"]')).toHaveCSS("width", "128px")
  // The native page hides behind its still so the editor can float over it.
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.locator("#browser-panel img")).toBeVisible()

  await editor.fill("Make this the primary colour")
  await root.getByRole("button", { name: "Add element comment", exact: true }).click()
  await expect(root.getByTestId("fixture-comments")).toHaveText("button.primary @e7: Make this the primary colour")
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(0)
  await expect(root.getByText("Highlights: clear", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByTestId("fixture-comment-metadata")).toContainText('selector \\"main > button.primary\\"')
  await expect(root.getByTestId("fixture-comment-metadata")).toContainText("accessible name")

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

story("leaves the picker off and Escape to the app when main never answers", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  await root.getByRole("button", { name: "Drop picker requests", exact: true }).click()
  await picker.click()
  await expect(picker).toHaveAttribute("aria-pressed", "false")

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await expect(address).toBeFocused()
  await address.press("Escape")
  await expect(address).not.toBeFocused()
})

story("replaces an open page note with the comment for an element picked meanwhile", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.locator('[data-component="browser-address"]').hover()
  await root.getByRole("button", { name: "Add page to session", exact: true }).click()
  await expect(root.locator('[data-slot="browser-comment-editor"] textarea')).toBeFocused()

  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(1)
  await expect(root.locator('[data-slot="browser-comment-editor"]')).toContainText("button.primary")
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

story("grows the compact comment upward without flipping and keeps its actions inside the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("low")
  await root.getByRole("button", { name: "Select an element to comment on", exact: true }).click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  const editor = root.locator('[data-slot="browser-comment-editor"]')
  const field = editor.locator("textarea")
  await expect(editor).toHaveCSS("width", "320px")
  await expect(field).toBeFocused()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const opening = await editor.boundingBox()

  if (!opening) throw new Error("Missing opening annotation")
  await field.fill("A line of feedback\n".repeat(6))
  await expect(field).toHaveCSS("height", "140px")
  // The field lays out before ResizeObserver repositions its parent.
  await expect
    .poll(async () => {
      const grown = await editor.boundingBox()

      return !!grown && grown.y < opening.y && Math.abs(grown.y + grown.height - opening.y - opening.height) < 0.5
    })
    .toBe(true)
  await field.fill("A line of feedback\n".repeat(30))
  await expect(field).toHaveCSS("height", "160px")
  expect(await field.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect
    .poll(async () => {
      const surface = await root.locator('[data-component="browser-comment"]').boundingBox()
      const box = await editor.boundingBox()

      return !!surface && !!box && box.y >= surface.y && box.y + box.height <= surface.y + surface.height
    })
    .toBe(true)
  const submit = editor.getByRole("button", { name: "Add element comment", exact: true })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
  // Near the surface's top, growth stops at the opening bottom rather than pushing the card down.
  await field.press("Escape")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("default")
  await root.getByRole("button", { name: "Select an element to comment on", exact: true }).click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(field).toBeFocused()
  const nearTop = await editor.boundingBox()

  if (!nearTop) throw new Error("Missing near-top annotation")
  await field.fill("A line of feedback\n".repeat(30))
  await expect
    .poll(() => field.evaluate((element) => element.clientHeight < 160 && element.scrollHeight > element.clientHeight))
    .toBe(true)
  await expect
    .poll(async () => {
      const box = await editor.boundingBox()

      return !!box && Math.abs(box.y + box.height - nearTop.y - nearTop.height) < 0.5
    })
    .toBe(true)
  // A narrow, short pane still keeps the compact editor and action within its surface.
  await root.locator("#browser-panel").evaluate((element) => {
    const container = element.parentElement

    if (!container) throw new Error("Missing pane container")
    container.style.width = "280px"
    container.style.height = "150px"
  })
  await expect(editor).toHaveCSS("width", "262px")
  await expect
    .poll(async () => {
      const surface = await root.locator('[data-component="browser-comment"]').boundingBox()
      const box = await editor.boundingBox()

      return !!surface && !!box && box.y >= surface.y && box.y + box.height <= surface.y + surface.height
    })
    .toBe(true)
  await expect(submit).toBeInViewport()
})

story(
  "wraps the selector, attaches elements without comments, and cancels only empty drafts on clickaway",
  async ({ page }) => {
    const root = page.getByTestId("browser-pane-fixture")
    const scenario = root.getByRole("combobox", { name: "Picked element scenario" })
    const picker = root.getByRole("button", { name: "Select an element to comment on", exact: true })
    const editor = root.locator('[data-slot="browser-comment-editor"]')
    const overlay = root.locator('[data-component="browser-comment"]')
    await scenario.selectOption("long")
    await root.evaluate((element) => element.setAttribute("dir", "rtl"))
    await picker.click()
    await root.getByRole("button", { name: "Pick element", exact: true }).click()
    const preview = editor.locator('[data-slot="line-comment-v2-preview"] [dir="ltr"]')
    const selector = `main > section[data-label="إعدادات"] > ${".nested-selector".repeat(24)} > button.primary`
    await expect(preview).toHaveText(selector)
    await expect(preview).toHaveAttribute("dir", "ltr")
    await expect(preview).toHaveCSS("unicode-bidi", "isolate")
    await expect(preview).toHaveCSS("-webkit-line-clamp", "2")
    await expect(preview).toHaveCSS("height", "40px")
    await preview.hover()
    await expect(page.getByRole("tooltip")).toHaveText(selector)
    await editor.locator("textarea").press("Enter")
    await expect(overlay).toHaveCount(0)
    const comments = root.getByTestId("fixture-comments").getByRole("listitem")
    await expect(comments).toHaveText(["button.primary @e7:"])

    await scenario.selectOption("default")
    await picker.click()
    await root.getByRole("button", { name: "Pick element", exact: true }).click()
    await editor.getByRole("button", { name: "Add element", exact: true }).click()
    await expect(overlay).toHaveCount(0)
    await expect(comments).toHaveText(["button.primary @e7:", "button.primary @e7:"])
    expect(JSON.parse(await root.getByTestId("fixture-comment-metadata").innerText())).toEqual(
      [selector, "main > button.primary"].map((value) =>
        expect.objectContaining({
          type: "note",
          label: "button.primary",
          title: value,
          subtitle: "Browser annotation",
          comment: "",
          subject: `the "button.primary" element in browser tab tab_11111111-1111-1111-1111-111111111111 at https://alpha.example/ (role button; accessible name "Save changes"; selector ${JSON.stringify(value)})`,
          live: {
            href: "tab_11111111-1111-1111-1111-111111111111#e7",
            subject: `the "button.primary" element in browser tab tab_11111111-1111-1111-1111-111111111111 at https://alpha.example/ (role button; accessible name "Save changes"; selector ${JSON.stringify(value)}; browser ref @e7, usable as ref in any browser tool including browser.evaluate until the page navigates)`,
          },
        }),
      ),
    )

    await scenario.selectOption("fallback")
    await picker.click()
    await root.getByRole("button", { name: "Pick element", exact: true }).click()
    await expect(preview).toHaveText("button.primary")
    await editor.locator("textarea").fill("Keep this feedback")
    await overlay.click({ position: { x: 620, y: 290 } })
    await expect(editor.locator("textarea")).toHaveValue("Keep this feedback")
    await editor.locator("textarea").fill("")
    await overlay.click({ position: { x: 620, y: 290 } })
    await expect(overlay).toHaveCount(0)
    await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
    await expect(comments).toHaveText(["button.primary @e7:", "button.primary @e7:"])
  },
)

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

  // Focusing and leaving the field before the browser reports keeps the submitted address.
  await address.focus()
  await expect(address).toHaveValue("https://example.com/")
  await address.press("Escape")
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
  const options = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option")
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

story("shows the page's cookies in the site information and clears them", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  await expect(site).toContainText("3 cookies in use")
  await site.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(site).toContainText("0 cookies in use")
})

story("says a failed cookie read failed and reads again on retry", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Fail next site read", exact: true }).click()
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  await expect(site).toContainText("Request failed")
  const retry = site.getByRole("button", { name: "Try again", exact: true })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(site).toContainText("3 cookies in use")
  await expect(site.getByRole("button", { name: "Clear", exact: true })).toBeEnabled()
})

story("Browser options keeps its original hand-off target until dismissed", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Browser options" }).click()
  const handoff = page.getByRole("menuitem", { name: "Open in default browser" })
  await expect(handoff).toBeVisible()
  await root.getByRole("button", { name: "Blank page", includeHidden: true }).dispatchEvent("click")
  await expect(handoff).toBeVisible()
  await handoff.click()
  await expect(root.getByText("External:", { exact: true })).toBeAttached()
})

story("Browser options says why a disabled hand-off is unavailable", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", includeHidden: true }).dispatchEvent("click")
  await root.getByRole("button", { name: "Browser options" }).click()
  await expect(page.getByRole("menuitem", { name: "Open in default browser" })).toBeDisabled()
  await expect(page.getByRole("menu").getByText("Not available in the default browser", { exact: true })).toBeVisible()
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
  await zoom.click()
  await expect(root.getByText("Zoom: 100", { exact: true })).toBeVisible()
  await expect(zoom).toBeHidden()
})

story("shows a page dialog in the pane instead of the page, and answers it with Escape", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const native = root.getByTestId("native-Alpha")
  // The fixture's controls sit below the pane, outside the viewport.
  await root.getByRole("button", { name: "Page confirm", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "alpha.example says" })
  await expect(dialog).toContainText("Discard the draft?")
  await expect(dialog).toContainText("1 more waiting")
  await expect(dialog.getByRole("checkbox", { name: "Stop this page from showing more dialogs" })).toBeVisible()
  // A page blocked in a dialog draws nothing: the native view hides, and the dialog sits over the page's box.
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(dialog.getByRole("button", { name: "OK", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(root.getByText('Answers: [{"kind":"dialog","accept":false,"text":"","stop":false}]', { exact: true })).toBeVisible()
  await expect(native).toHaveAttribute("data-visible", "true")
})

story("asks for a site's permission in a bar while the page stays usable", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  await expect(bar).toContainText("alpha.example wants to show notifications.")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  const always = bar.getByRole("button", { name: "Always allow", exact: true })
  const answered = root.getByText('Answers: [{"kind":"permission","allow":true,"remember":true}]', { exact: true })
  // A page can make the bar appear under a click the user is making: a press right after it appears does nothing.
  await always.click()
  await expect(bar).toBeVisible()
  await expect(root.getByText("Answers: []", { exact: true })).toBeVisible()
  // Once the bar has been there long enough to read, a new press answers it.
  await expect(async () => {
    await always.click({ timeout: 1_000 })
    await expect(answered).toBeVisible({ timeout: 200 })
  }).toPass()
  await expect(bar).toBeHidden()
})

story("starts the bar's input protection over when the page asks again", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  const once = bar.getByRole("button", { name: "Allow this time", exact: true })
  await expect(once).toBeVisible()
  // The delay is the contract: let the first appearance's run out, so only a restart can refuse the next press.
  await page.waitForTimeout(600)
  // The page asks again: the same bar shows anew, so a press at once does nothing.
  await root.getByRole("button", { name: "Repeat permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  await once.click()
  await expect(bar).toBeVisible()
  await expect(root.getByText("Answers: []", { exact: true })).toBeVisible()
  await expect(async () => {
    await once.click({ timeout: 1_000 })
    await expect(root.getByText('Answers: [{"kind":"permission","allow":true,"remember":false}]', { exact: true })).toBeVisible({
      timeout: 200,
    })
  }).toPass()
})

story("takes the keyboard from the window for a dialog and gives it back where it was", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const composer = root.getByRole("textbox", { name: "Composer stand-in" })
  await composer.focus()
  await root.getByRole("button", { name: "Page confirm", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "alpha.example says" })
  await expect(dialog.getByRole("button", { name: "OK", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(composer).toBeFocused()
})

story("asks again for an agent's request without offering to keep the answer, and says why", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Agent permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  await expect(bar).toContainText("alpha.example wants to use your microphone.")
  await expect(bar).toContainText("The agent is working in this tab; your answer is for this request only.")
  await expect(bar.getByRole("button", { name: "Always allow", exact: true })).toHaveCount(0)
  await expect(bar.getByRole("button", { name: "Allow this time", exact: true })).toBeVisible()
  // Enter on the bar never grants: focus starts on the refusing button.
  await bar.getByRole("button", { name: "Block", exact: true }).focus()
  await expect(async () => {
    await page.keyboard.press("Enter")
    await expect(root.getByText('Answers: [{"kind":"permission","allow":false,"remember":false}]', { exact: true })).toBeVisible({
      timeout: 200,
    })
  }).toPass()
})

story("asks for a page's prompt text and sends what the user typed", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Page prompt", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "alpha.example says" })
  await expect(dialog).toContainText("Name the copy")
  const field = dialog.getByRole("textbox", { name: "Your answer" })
  await expect(field).toHaveValue("Draft")
  await expect(field).toHaveAttribute("maxlength", "2000")
  await field.fill("Final copy")
  const answered = root.getByText('Answers: [{"kind":"dialog","accept":true,"text":"Final copy","stop":false}]', { exact: true })
  await expect(async () => {
    await field.press("Enter")
    await expect(answered).toBeVisible({ timeout: 200 })
  }).toPass()
  await expect(dialog).toBeHidden()
})

// What the key test below records in the story's window.
declare global {
  interface Window {
    keyLog: KeyboardEvent[]
    keyBehind: string[]
  }
}

story("keeps the keys inside a page prompt, and leaves them to the window once the keyboard is elsewhere", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  // Each key as the window saw it first, and whether its default was cancelled once every handler had seen it.
  await page.evaluate(() => {
    const log: KeyboardEvent[] = []
    // Keys the window's own handlers behind the prompt would see, as the composer's and the zoom's do.
    const behind: string[] = []
    Object.assign(window, { keyLog: log, keyBehind: behind })
    window.addEventListener("keydown", (event) => log.push(event), { capture: true })
    window.addEventListener("keydown", (event) => behind.push(event.key))
  })
  const behind = () => page.evaluate(() => window.keyBehind.splice(0))

  const log = () =>
    page.evaluate(() =>
      window.keyLog
        .splice(0)
        .filter((event) => !["Control", "Alt", "Shift", "Meta"].includes(event.key))
        .map((event) => `${event.key}:${event.defaultPrevented ? "prevented" : "default"}`),
    )

  await root.getByRole("button", { name: "Page prompt", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "alpha.example says" })
  const field = dialog.getByRole("textbox", { name: "Your answer" })
  await expect(field).toBeFocused()
  await field.press("End")
  await page.keyboard.type(" two")
  await log()

  // Reload, the agent switch, find, close and new tab, zoom and history do nothing here.
  for (const chord of ["Control+r", "Control+.", "Control+f", "Control+w", "Control+t", "Control+Equal", "Alt+ArrowLeft", "F5"])
    await page.keyboard.press(chord)
  expect(await log()).toEqual(["r", ".", "f", "w", "t", "=", "ArrowLeft", "F5"].map((key) => `${key}:prevented`))
  // Editing keys edit the field as they do anywhere.
  await page.keyboard.press("Control+a")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Backspace")
  expect(await log()).toEqual(["a:default", "ArrowRight:default", "Backspace:default"])
  await expect(field).toHaveValue("Draft tw")
  await expect(dialog).toBeVisible()
  // None of them went past the prompt to the window's handlers.
  expect(await behind()).toEqual([])

  // With the keyboard in the composer, its keys are the app's and the prompt stays open.
  await root.getByRole("textbox", { name: "Composer stand-in" }).focus()
  await page.keyboard.press("Control+r")
  expect(await log()).toEqual(["r:default"])
  expect(await behind()).toEqual(["Control", "r"])
  await expect(dialog).toBeVisible()

  await field.focus()
  await expect(async () => {
    await field.press("Enter")
    await expect(root.getByText('Answers: [{"kind":"dialog","accept":true,"text":"Draft tw","stop":false}]', { exact: true })).toBeVisible({
      timeout: 200,
    })
  }).toPass()
})

story("asks for a site's sign-in with its realm, says the last one failed, and keeps nothing on cancel", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Sign-in request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "Sign in to intranet.alpha.example" })
  // The realm sits in its sentence inside directional isolates.
  await expect(dialog).toContainText(/The site says: “\u2068Staff area\u2069”/)
  await expect(dialog.getByRole("alert")).toBeVisible()
  const user = dialog.getByRole("textbox", { name: "User name" })
  await expect(user).toBeFocused()
  await expect(user).toHaveAttribute("maxlength", "1024")
  await user.fill("demo")
  await dialog.getByLabel("Password").fill("secret")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(root.getByText('Answers: [{"kind":"dismiss"}]', { exact: true })).toBeVisible()
})
