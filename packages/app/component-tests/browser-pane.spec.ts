import type { Locator, Page } from "@playwright/test"
import { expect, sourceURL, test } from "../../lab/playwright/test"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/panel.fixture.tsx"),
  embeds: source("../src/runtime/plugin/embeds.tsx"),
  links: source("../src/runtime/plugin/app-links.ts"),
  panelMotion: source("../src/shell/panel-motion.ts"),
  language: source("../src/runtime/i18n/language.tsx"),
}

// Panel motion reads `navigator.platform` on each drag, so a test pins the platform whose behaviour it covers.
const pinPlatform = (page: Page, platform: string) =>
  page.evaluate((value) => {
    Object.defineProperty(navigator, "platform", { value, configurable: true })
  }, platform)

test.beforeEach(async ({ mount, page }) => {
  // Any page loads the app styles; the fixture mounts the pane beside it on the real host embeds.
  await mount("ui-line-comment--editor")
  await mountPane(page)
  await expect(page.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

async function mountPane(page: Page) {
  await page.evaluate(async (modules) => {
    const [{ mountBrowserPane }, { createEmbeds }, { appLinkRoute, createAppLinks }, panelMotion, language] = await Promise.all([
      import(modules.fixture),
      import(modules.embeds),
      import(modules.links),
      import(modules.panelMotion),
      import(modules.language),
    ])

    mountBrowserPane({
      createEmbeds,
      createAppLinks,
      appLinkRoute,
      panelMotion,
      LanguageProvider: language.LanguageProvider,
      UiI18nBridge: language.UiI18nBridge,
      useLanguage: language.useLanguage,
    })
  }, modules)
}

test("reviews the actual application target only after a trusted click", async ({ page }) => {
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

test("accepts an assistive activation of the focused link, not a synthetic or unfocused one", async ({ page }) => {
  const sanitizer = sourceURL(new URL("../../session-ui/src/components/markdown-cache.tsx", import.meta.url))
  // A phone link keeps its href, so Chromium activates it on Enter.
  const url = "tel:+15555550100"
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

test("reviews an application link that carries download, and leaves a web download to the document", async ({ page }) => {
  const sanitizer = sourceURL(new URL("../../session-ui/src/components/markdown-cache.tsx", import.meta.url))
  await page.evaluate(async (sanitizer) => {
    const { enableMarkdownAppLinks, sanitizeMarkdown } = await import(sanitizer)
    const row = document.createElement("div")
    row.dataset.paneRow = ""
    row.dataset.testid = "download-links"
    row.innerHTML = sanitizeMarkdown(
      '<a download href="mailto:download@example.invalid?attach=fixture">Mail</a> <a download href="obsidian://open?vault=download">Vault</a> <a download href="https://example.invalid/report.csv">Report</a>',
    )
    enableMarkdownAppLinks(row)
    // A reviewed click never reaches here. Record the ones left to the document, and keep the fixture page in place.
    row.addEventListener("click", (event) => {
      row.dataset.passed = `${row.dataset.passed ?? ""}${event.target instanceof Element ? event.target.textContent : ""}`
      event.preventDefault()
    })
    document.querySelector('[data-testid="browser-pane-fixture"]')?.prepend(row)
  }, sanitizer)
  const notice = page.locator("#browser-panel").getByRole("status").filter({ hasText: "From the conversation" })
  const mail = page.getByRole("link", { name: "Mail" })
  await expect(mail).not.toHaveAttribute("download")
  // The attribute put back after sanitizing does not take the link past the host either: a mail link with an
  // attachment is only copied.
  await mail.evaluate((node) => node.setAttribute("download", ""))
  await mail.click()
  await expect(page.locator("body")).toHaveAttribute("data-copy", "mailto:download@example.invalid?attach=fixture")
  await expect(notice).toHaveCount(0)
  await page.getByRole("link", { name: "Vault" }).click()
  await expect(notice).toContainText("obsidian://open?vault=download")
  await page.getByRole("link", { name: "Report" }).click()
  await expect(page.getByTestId("download-links")).toHaveAttribute("data-passed", "Report")
  await expect(notice).toContainText("obsidian://open?vault=download")
})

test("opens a mail link in the system mail app, never in the pane", async ({ page }) => {
  const sanitizer = sourceURL(new URL("../../session-ui/src/components/markdown-cache.tsx", import.meta.url))
  const url = "mailto:hello@example.invalid?subject=Report"
  await page.evaluate(async ({ sanitizer, url }) => {
    const { enableMarkdownAppLinks, sanitizeMarkdown } = await import(sanitizer)
    const row = document.createElement("div")
    row.dataset.paneRow = ""
    row.innerHTML = sanitizeMarkdown(`<a href="${url}">Write to us</a>`)
    enableMarkdownAppLinks(row)
    // A click the host does not take would navigate the fixture page away.
    row.addEventListener("click", (event) => event.preventDefault())
    document.querySelector('[data-testid="browser-pane-fixture"]')?.prepend(row)
  }, { sanitizer, url })
  await page.getByRole("link", { name: "Write to us" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-mail", url)
  await expect(page.locator("#browser-panel").getByText(url)).toHaveCount(0)
  await expect(page.locator("#browser-panel").getByRole("status").filter({ hasText: "From the conversation" })).toHaveCount(0)
})

test("moves the native page when a fixed-size pane changes position", async ({ page }) => {
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

test("reconnects the observation spine after its panel reattaches", async ({ page }) => {
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

test("a spinner inside a persistent floating surface does not measure the pane each frame", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")

  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector<HTMLElement>('[data-component="browser-preview"] > :first-child')!
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

test("stops measuring the pane once a finite animation ends or is cancelled", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  const x = Number(await native.getAttribute("data-x"))

  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector<HTMLElement>('[data-component="browser-preview"] > :first-child')!
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

test("does not measure when the pane's own still enters or leaves its box", async ({ page }) => {
  const reads = await page.locator("#browser-panel").evaluate(async (panel) => {
    const box = panel.querySelector<HTMLElement>('[data-component="browser-preview"] > :first-child')!
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

test("hides the page when a portalled surface grows over it by a text edit alone", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")
  await page.emulateMedia({ reducedMotion: "reduce" })

  const text = await page.locator("#browser-panel").evaluateHandle((panel) => {
    const pane = panel.querySelector<HTMLElement>('[data-component="browser-preview"] > :first-child')!.getBoundingClientRect()
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

test("covers the page with unmarked portalled surfaces but not tooltips or transparent wrappers", async ({ page }) => {
  const native = page.getByTestId("native-Alpha")

  const portal = await page.locator("#browser-panel").evaluateHandle((panel) => {
    const pane = panel.querySelector<HTMLElement>('[data-component="browser-preview"] > :first-child')!.getBoundingClientRect()
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

test("covers the page with an app dialog's backdrop for as long as the backdrop is there", async ({ mount, page }) => {
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

test("tracks a fixed-size pane through a sibling resize, ancestor scroll and animation", async ({ page }) => {
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

test("hides a native page when another takes the pane, the pane hides, or it unmounts", async ({ page }) => {
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

test("hides the native view immediately while the pane stays mounted", async ({ page }) => {
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

test("updates the selected match while the same find field stays focused", async ({ page }) => {
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

test("paints a still of the page in place of the native view while a panel moves", async ({ page }) => {
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

test("paints a still of the page in place of the native view while a resize handle is dragged", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const handle = root.getByTestId("pane-resize-handle")
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")
  await pinPlatform(page, "Linux x86_64")

  // On Linux a native view's bounds land on screen frames before the DOM around it, so one left up through a drag jumps
  // against its pane on every move. A click on the handle moves nothing and must not blink the page out. Read in the
  // same task as each event, so a view hidden and shown again before the next frame cannot pass.
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

for (const platform of ["MacIntel", "Win32"]) {
  test(`keeps the native view live through a press, a drag and the release of a resize handle on ${platform}`, async ({ page }) => {
    const root = page.getByTestId("browser-pane-fixture")
    const handle = root.getByTestId("pane-resize-handle")
    const native = root.getByTestId("native-Alpha")
    const still = root.locator("#browser-panel img")
    await pinPlatform(page, platform)
    const box = await handle.boundingBox()

    if (!box) throw new Error("Missing pane resize handle")
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const width = Number(await native.getAttribute("data-width"))
    const calls = (await native.getAttribute("data-layout-calls")) ?? ""

    // macOS and Windows put a native view's bounds and the DOM around it on the same frame, so the page keeps laying
    // out through the drag instead of hiding behind a still, which blanks the box until the still paints. Every change
    // of the view's visibility is recorded, so one hidden and shown again before the next frame cannot pass.
    const flips = await native.evaluateHandle((element) => {
      const flips: (string | null)[] = []
      new MutationObserver((records) => flips.push(...records.map((record) => record.oldValue))).observe(element, {
        attributeFilter: ["data-visible"],
        attributeOldValue: true,
      })

      return flips
    })

    const frames = () =>
      page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    // A real press: the handle takes the pointer, and main hears nothing until it moves.
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await expect(handle).toHaveAttribute("data-dragging", "")
    await frames()
    await expect(native).toHaveAttribute("data-layout-calls", calls)

    // Main gets the bounds of every move.
    for (const moved of [10, 20, 30, 40]) {
      await page.mouse.move(at.x - moved, at.y)
      await expect(native).toHaveAttribute("data-width", String(width - moved))
    }

    await expect(still).toHaveCount(0)
    await page.mouse.up()
    await expect(handle).not.toHaveAttribute("data-dragging")
    await frames()
    await expect(native).toHaveAttribute("data-width", String(width - 40))
    await expect(still).toHaveCount(0)
    expect(await flips.jsonValue()).toEqual([])
  })
}

test("shows the native view again when the window loses focus mid-drag", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const handle = root.getByTestId("pane-resize-handle")
  const native = root.getByTestId("native-Alpha")
  const still = root.locator("#browser-panel img")
  await pinPlatform(page, "Linux x86_64")

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

test("never flies a still of a page the tab has navigated away from", async ({ page }) => {
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

test("refreshes page stills by the window's focus, not the document's", async ({ page }) => {
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

test("keeps a still of the page under floating content that covers it", async ({ page }) => {
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

test("covers the page with its warm still only once the capture is back, and through the thaw", async ({ page }) => {
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

test(
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

test("keeps a still of the page under an open dialog instead of blanking the pane", async ({ page }) => {
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

test("hides the native page under a dialog even when its still never arrives", async ({ page }) => {
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

test("comments on a picked element over a still of the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("zoomed")
  const picker = commentTool(root)
  await picker.click()
  await expect(picker.picking).toBeAttached()
  await expect(picker.button).toHaveAttribute("aria-pressed", "true")
  await expect(root.getByText("Picker: on", { exact: true })).toBeVisible()
  await expect(root.getByText("Session getter reads: 0", { exact: true })).toBeVisible()
  await expect(root.getByRole("status")).toHaveText(
    "Click part of the page to comment on it. Press Escape to cancel.",
  )

  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(picker.picking).toHaveCount(0)
  await expect(picker.button).toHaveAttribute("aria-pressed", "false")
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveAttribute("placeholder", "Add an optional comment...")
  await expect(editor).toHaveAccessibleName("Comment on this part of the page")
  await expect(root.getByText("Session getter reads: 0", { exact: true })).toBeVisible()
  await expect(root.locator('[data-slot="browser-comment-editor"]')).toContainText("button.primary")
  // The spotlight frames the picked element in surface pixels.
  await expect(root.locator('[data-slot="browser-comment-spotlight"]')).toHaveCSS("left", "38.4px")
  await expect(root.locator('[data-slot="browser-comment-spotlight"]')).toHaveCSS("width", "128px")
  // The native page hides behind its still so the editor can float over it.
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.locator("#browser-panel img")).toBeVisible()

  await editor.fill("Make this the primary colour")
  await root.getByRole("button", { name: "Add comment", exact: true }).click()
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

test("cancels the picker and a comment with Escape", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = commentTool(root)
  await picker.click()
  await expect(picker.picking).toBeAttached()
  await page.keyboard.press("Escape")
  await expect(picker.picking).toHaveCount(0)
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

test("leaves the picker off and Escape to the app when main never answers", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = commentTool(root)
  await root.getByRole("button", { name: "Drop picker requests", exact: true }).click()
  await picker.click()
  await expect(picker.picking).toHaveCount(0)

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await expect(address).toBeFocused()
  await address.press("Escape")
  await expect(address).not.toBeFocused()
})

test("replaces an open page note with the comment for an element picked meanwhile", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await addPage(page, root)
  await expect(root.locator('[data-slot="browser-comment-editor"] textarea')).toBeFocused()

  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(1)
  await expect(root.locator('[data-slot="browser-comment-editor"]')).toContainText("button.primary")
})

test("cleans up the originating session's picker and comment after a session switch", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = commentTool(root)
  await picker.click()
  await expect(root.getByText("Picker Alpha: on", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await expect(root.getByText("Picker Alpha: off", { exact: true })).toBeVisible()
  await expect(picker.picking).toHaveCount(0)

  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await picker.click()
  await root.getByRole("button", { name: "Pick element", exact: true }).click()
  await expect(root.locator('[data-slot="browser-comment-editor"] textarea')).toBeFocused()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.locator('[data-component="browser-comment"]')).toHaveCount(0)
  await expect(root.getByText("Highlights: clear", { exact: true })).toBeVisible()
  await expect(root.getByText("Highlight owners: Alpha", { exact: true })).toBeVisible()
})

test("ends the native picker and highlight when the pane unmounts", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const picker = commentTool(root)
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

test("keeps a comment draft but drops its ref when the page navigates", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await commentTool(root).click()
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

test("grows the compact comment upward without flipping and keeps its actions inside the page", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("low")
  await commentTool(root).click()
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
  const submit = editor.getByRole("button", { name: "Add comment", exact: true })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
  // Near the surface's top, growth stops at the opening bottom rather than pushing the card down.
  await field.press("Escape")
  await root.getByRole("combobox", { name: "Picked element scenario" }).selectOption("default")
  await commentTool(root).click()
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

test(
  "wraps the selector, attaches elements without comments, and cancels only empty drafts on clickaway",
  async ({ page }) => {
    const root = page.getByTestId("browser-pane-fixture")
    const scenario = root.getByRole("combobox", { name: "Picked element scenario" })
    const picker = commentTool(root)
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
    await editor.getByRole("button", { name: "Add to session", exact: true }).click()
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

test("shows the empty state over a blank native page and restores navigation", async ({ page }) => {
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

test("keeps Stop available and hides the empty state while a blank page loads", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Loading page", exact: true }).click()
  await expect(root.getByText("Open a page", { exact: true })).toBeHidden()
  await root.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

test("keeps the submitted URL visible until the browser reports navigation", async ({ page }) => {
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

test("restores the current URL each time the same submitted navigation is blocked", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })

  for (const submission of [1, 2]) {
    await test.step(`blocked submission ${submission}`, async () => {
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

test("explains why a typed address cannot open instead of searching for it", async ({ page }) => {
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

test("shows a themed failure state for only the failed tab and allows retry", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  // The page area alone explains a load that failed: what happened in plain words, what to do, and Chromium's code
  // small under it. Nothing is raised above the page beside it.
  const failure = root.locator('[data-component="browser-failure"]')
  await expect(failure.getByRole("heading", { name: "This site can't be reached", exact: true })).toBeVisible()
  await expect(failure.getByText("Check the address for typing mistakes. If it is right, the site may be down.", { exact: true })).toBeVisible()
  await expect(failure.getByText("ERR_CONNECTION_REFUSED", { exact: true })).toBeVisible()
  await expect(root.getByRole("alert")).toHaveCount(0)
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByRole("combobox", { name: "Browser address", exact: true })).toHaveValue(
    "https://alpha.example/",
  )

  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("This site can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(root.getByText("This site can't be reached", { exact: true })).toBeVisible()

  await failure.getByRole("button", { name: "Reload", exact: true }).click()
  await expect(root.getByText("This site can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

test("a command that did not work says what was tried above the page and offers it again", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Fail next command", exact: true }).click()
  await root.getByRole("button", { name: "Reload", exact: true }).click()
  const notice = root.locator('[data-component="browser-failure-bar"]')
  // Main's own message never reaches the person, and neither does the app's generic failure text.
  await expect(notice.getByRole("alert")).toHaveText("Couldn't reload this page.")
  await expect(root.getByText("Request failed", { exact: true })).toHaveCount(0)
  await expect(root.getByText("did not finish starting")).toHaveCount(0)
  // The page stays where it was; trying again sends the same command, which takes the notice away.
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await notice.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(notice).toHaveCount(0)
})

test("returns a failed tab to the empty state when an empty URL is submitted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  await expect(root.getByText("This site can't be reached", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("")
  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByText("This site can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByText("Open a page", { exact: true })).toBeVisible()
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeDisabled()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

test("selects the full URL when the address field gains focus", async ({ page }) => {
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

test("draws only the address at rest when focus leaves the window with the field selected", async ({ page }) => {
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

test("keeps the current page visible while a submitted URL loads", async ({ page }) => {
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

test("keeps the current page and restores its URL when an empty address is submitted", async ({ page }) => {
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

test("lists the typed text with visited pages, and opens the first row: the page the typing completes, else the text", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed history", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await address.pressSequentially("localhost")
  const options = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option")
  // The page whose address begins with the text is first and chosen; the search for the text follows it.
  await expect(options).toHaveCount(2)
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await expect(address).toHaveValue("localhost:5173/settings")
  // Arrow keys that pick IME candidates leave the list alone.
  await address.dispatchEvent("keydown", { key: "ArrowDown", isComposing: true })
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await address.press("Enter")
  await expect(address).toHaveValue("http://localhost:5173/settings")

  // Words that only match a page list it below the search for them, which is first and chosen; a step down opens it.
  await address.click()
  await address.pressSequentially("color format")
  await expect(options).toHaveCount(2)
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await expect(options.first()).toHaveText("color format-Google Search")
  await address.press("Enter")
  await expect(address).toHaveValue("https://www.google.com/search?q=color%20format")
  await address.click()
  await address.pressSequentially("color format")
  await address.press("ArrowDown")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")
  await address.press("Enter")
  await expect(address).toHaveValue("https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Colors/Color_format_converter")
})

test("finds imported pages by their words, completes the site a host begins, and forgets a page on Shift+Delete", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed imported history", exact: true }).click()
  await expect(root.getByText("Main history: 59", { exact: true })).toBeVisible()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const options = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option")
  const addresses = () => options.locator('[data-slot="browser-page-row-url"]')

  // Main answers after the field shows the text: under the search for it, the list fills with the best matches of 59
  // pages, the most visited first, and a word found only inside another ("prune") last.
  await address.click()
  await address.pressSequentially("rune")
  await expect(addresses()).toHaveText([
    "Google Search",
    "github.com/anomalyco/rune-desktop",
    "github.com/anomalyco/rune-desktop/pulls",
    "docs.rune.example/guide/getting-started",
    "github.com/anomalyco/rune-desktop/issues/128",
    "github.com/runelabs/rune-lang",
  ])
  await expect(options.nth(1).locator("mark")).toHaveText(["rune", "Rune", "rune"])
  // The search row is the typed text itself, so it draws no match.
  await expect(options.first().locator("mark")).toHaveCount(0)
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  // Imported pages have no icon of their own: the globe stands in, and none is fetched.
  await expect(options.locator("img")).toHaveCount(0)

  // Both words, in either order, wherever each starts a part of the address.
  await address.fill("")
  await address.pressSequentially("desk anom")
  await expect(addresses()).toHaveText([
    "Google Search",
    "github.com/anomalyco/rune-desktop",
    "github.com/anomalyco/rune-desktop/pulls",
    "github.com/anomalyco/rune-desktop/issues/128",
  ])

  // Shift+Delete forgets the chosen page, in main's history too; on the typed text's row the key is the field's own.
  await address.fill("")
  await address.pressSequentially("rune")
  await expect(options).toHaveCount(6)
  await address.press("Shift+Delete")
  await expect(root.getByText("Main history: 59", { exact: true })).toBeVisible()
  await address.press("ArrowDown")
  await address.press("Shift+Delete")
  // The row that takes its place is the chosen one, and the field shows its address.
  await expect(addresses().nth(1)).toHaveText("github.com/anomalyco/rune-desktop/pulls")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(address).toHaveValue("https://github.com/anomalyco/rune-desktop/pulls")
  await expect(root.getByText("Main history: 58", { exact: true })).toBeVisible()

  // Text that begins a host completes its site, which Enter opens.
  await address.fill("")
  await address.pressSequentially("gith")
  await expect(addresses().first()).toHaveText("github.com/")
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await address.press("Enter")
  await expect(address).toHaveValue("https://github.com/")
})

test("keeps the first row chosen and moves through the list with Chrome's keys", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed imported history", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const list = page.getByRole("listbox", { name: "Suggestions" })
  const options = list.getByRole("option")
  const addresses = options.locator('[data-slot="browser-page-row-url"]')
  const selection = () => address.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))
  // The places of the chosen rows: always exactly one while the list is open.
  const chosen = () => options.evaluateAll((rows) => rows.flatMap((row, place) => (row.getAttribute("aria-selected") === "true" ? [place] : [])))

  // The typed text completes to the site: the rest of its address is in the field, selected, and its row is chosen.
  await address.click()
  await address.pressSequentially("gith")
  await expect(address).toHaveValue("github.com")
  await expect.poll(selection).toBe("ub.com")
  await expect(addresses.first()).toHaveText("github.com/")
  await expect(options.nth(1)).toHaveText("gith-Google Search")
  await expect(options).toHaveCount(6)
  await expect.poll(chosen).toEqual([0])

  // Backspace removes the completed part only; deleting never completes, so the typed text is first and chosen.
  await address.press("Backspace")
  await expect(address).toHaveValue("gith")
  await expect(options.first()).toHaveText("gith-Google Search")
  await expect(addresses.nth(1)).toHaveText("github.com/")
  await expect.poll(chosen).toEqual([0])
  // The next character completes again, and typing goes on through the selected part.
  await address.pressSequentially("ub")
  await expect(address).toHaveValue("github.com")
  await expect.poll(selection).toBe(".com")

  // Down and Up choose a row and put its text in the field; past either end the choice goes around.
  await address.press("ArrowDown")
  await expect(address).toHaveValue("github")
  await expect.poll(chosen).toEqual([1])
  await address.press("ArrowUp")
  await expect(address).toHaveValue("https://github.com")
  await address.press("ArrowUp")
  await expect.poll(chosen).toEqual([5])
  await expect(address).toHaveValue(/^https:\/\/github\.com\/.+/)
  // Tab moves as Down does while the list is open, and keeps the focus in the field.
  await address.press("Tab")
  await expect.poll(chosen).toEqual([0])
  await address.press("Tab")
  await expect.poll(chosen).toEqual([1])
  await expect(address).toBeFocused()

  // Escape undoes one thing at a time: the row's text, the list, the typed text, then the focus.
  await address.press("Escape")
  await expect(address).toHaveValue("github.com")
  await expect.poll(selection).toBe(".com")
  await expect.poll(chosen).toEqual([0])
  await address.press("Escape")
  await expect(list).toBeHidden()
  await expect(address).toHaveValue("github")
  await address.press("Escape")
  await expect(address).toHaveValue("https://alpha.example/")
  await expect.poll(selection).toBe("https://alpha.example/")
  await expect(address).toBeFocused()
  await address.press("Escape")
  await expect(address).not.toBeFocused()

  // A caret that leaves the end takes the completed address into the text: the page stays first, and nothing is selected.
  await address.focus()
  await address.pressSequentially("gith")
  await expect.poll(selection).toBe("ub.com")
  await address.press("ArrowRight")
  await expect(address).toHaveValue("github.com")
  await expect.poll(selection).toBe("")
  await expect(addresses.first()).toHaveText("github.com/")
  await expect(options.nth(1)).toHaveText("github.com-Google Search")

  // A click opens the row it is on, chosen or not.
  await options.nth(2).click()
  await expect(address).toHaveValue(/^https:\/\/github\.com\/.+/)
  await expect(address).not.toBeFocused()
})

test("keeps the address bar working, and says so, while main's history cannot be read or cleared", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed history", exact: true }).click()
  await root.getByRole("button", { name: "Seed imported history", exact: true }).click()
  await root.getByRole("button", { name: "History away", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const options = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option")

  // Main rejects every question. The list still has the typed text and the window's own last pages.
  await address.click()
  await address.pressSequentially("localhost")
  await expect(options).toHaveCount(2)
  await expect(address).toHaveValue("localhost:5173/settings")
  // The imported pages are out of reach, so their words find only the search for them, which Enter opens.
  await address.fill("")
  await address.pressSequentially("rune")
  await expect(options).toHaveText(["rune-Google Search"])
  await address.press("Enter")
  await expect(address).toHaveValue("https://www.google.com/search?q=rune")

  // Clearing empties the window's list at once and says that main's history stayed.
  const clear = async () => {
    await root.getByRole("button", { name: "Browser options", exact: true }).click()
    await page.getByRole("menuitem", { name: "More tools", exact: true }).click()
    await page.getByRole("menuitem", { name: "Clear history", exact: true }).click()
  }

  await clear()
  await expect(root.getByText("Couldn't clear the history. Try again.", { exact: true })).toBeVisible()
  await expect(root.getByText("Main history: 59", { exact: true })).toBeVisible()
  // The item stays although the window's list is empty: main's history is still there to clear once it is back.
  await root.getByRole("button", { name: "History away", exact: true }).click()
  await clear()
  await expect(root.getByText("Main history: 0", { exact: true })).toBeVisible()
})

test("lists recent pages on a blank tab and opens one", async ({ page }) => {
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

test("keeps a page note editable beside a tiny viewport and attaches it to the session", async ({ page }) => {
  const { root, viewport, width, height } = viewportControls(page)
  await viewport.click()
  await width.fill("8")
  await height.fill("8")
  await expectSize(root.getByTestId("native-Alpha"), 8, 8)
  await addPage(page, root)
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await editor.click()
  await editor.fill("Check the header layout")
  await addPage(page, root)
  // The menu gives the keyboard back to its button a task after it closes, and would take it from an editor focused
  // in that task: the Enter below would then open the menu again.
  await expect(root.getByRole("button", { name: "Browser options", exact: true })).toBeFocused()
  await expect(editor).toHaveValue("Check the header layout")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments").getByRole("listitem")).toHaveText([/: Check the header layout$/])
})

test("adds the whole page to the session and keeps the draft when the button is pressed again", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await addPage(page, root)
  const editor = root.locator('[data-slot="browser-comment-editor"] textarea')
  await editor.click()
  await editor.fill("Check the header layout")
  await addPage(page, root)
  // As above: the menu's button has the keyboard again before the editor takes it.
  await expect(root.getByRole("button", { name: "Browser options", exact: true })).toBeFocused()
  await expect(editor).toHaveValue("Check the header layout")
  await editor.press("Enter")
  await expect(root.getByTestId("fixture-comments").getByRole("listitem")).toHaveText([/: Check the header layout$/])
})

test("shows the page's cookies in the site information and clears them", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  await site.getByRole("button", { name: "Site settings", exact: true }).click()
  // The row is "Cookies and site data", so its count needs no more words.
  await expect(site.getByText("3 cookies", { exact: true })).toBeVisible()
  await site.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(site.getByText("0 cookies", { exact: true })).toBeVisible()
})

test("site information opens on the site and its connection, with the rest one step away", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  // First: where the person is and whether the connection is private. Nothing about cookies or agents yet.
  await expect(site).toContainText("alpha.example")
  await expect(site).toContainText("Connection is secure")
  await expect(site).not.toContainText(/cookie/i)
  const settings = site.getByRole("button", { name: "Site settings", exact: true })
  await settings.click()
  // Second: everything else, with the way back holding the keyboard.
  await expect(site.getByRole("button", { name: "Back", exact: true })).toBeFocused()
  await expect(site.getByText("3 cookies", { exact: true })).toBeVisible()
  await expect(site).toContainText("You stay signed in.")
  await expect(site.getByRole("button", { name: "Clear saved files for this site", exact: true })).toBeEnabled()
  await expect(site).toContainText("Agents you allow can use this page")
  // Escape steps back one view, then closes.
  await page.keyboard.press("Escape")
  await expect(settings).toBeFocused()
  await expect(site).not.toContainText(/cookie/i)
  await page.keyboard.press("Escape")
  await expect(site).toBeHidden()
})

test("says a failed cookie read failed and reads again on retry", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Fail next site read", exact: true }).click()
  await root.getByRole("button", { name: "Site information", exact: true }).click()
  const site = page.getByRole("dialog")
  await site.getByRole("button", { name: "Site settings", exact: true }).click()
  await expect(site.getByText("Could not read site data.", { exact: true })).toBeVisible()
  const retry = site.getByRole("button", { name: "Try again", exact: true })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(site.getByText("3 cookies", { exact: true })).toBeVisible()
  await expect(site.getByRole("button", { name: "Clear", exact: true })).toBeEnabled()
})

test("Browser options keeps its original hand-off target until dismissed", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Browser options" }).click()
  await page.getByRole("menuitem", { name: "More tools", exact: true }).click()
  const handoff = page.getByRole("menuitem", { name: "Open in default browser" })
  await expect(handoff).toBeVisible()
  await root.getByRole("button", { name: "Blank page", includeHidden: true }).dispatchEvent("click")
  await expect(handoff).toBeVisible()
  await handoff.click()
  await expect(root.getByText("External:", { exact: true })).toBeAttached()
})

test("Browser options says why a disabled hand-off is unavailable", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", includeHidden: true }).dispatchEvent("click")
  await root.getByRole("button", { name: "Browser options" }).click()
  await page.getByRole("menuitem", { name: "More tools", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Open in default browser" })).toBeDisabled()
  await expect(page.getByRole("menu").getByText("This page can't open in your default browser", { exact: true })).toBeVisible()
})

function viewportControls(page: Page) {
  const root = page.getByTestId("browser-pane-fixture")

  const controls = root.getByRole("region", { name: "Viewport", exact: true })
  const options = root.getByRole("button", { name: "Browser options", exact: true })

  return {
    root,
    controls,
    // The toolbar's toggle is under Browser options > More tools. The menu gives the keyboard back to its button a
    // task after it closes, so the click waits for that: a control focused before then would lose the keyboard.
    viewport: {
      click: async () => {
        await options.click()
        await page.getByRole("menuitem", { name: "More tools", exact: true }).click()
        await page.getByRole("menuitem", { name: /^Toggle browser toolbar/ }).click()
        await expect(options).toBeFocused()
      },
    },
    preset: controls.getByRole("button", { name: "Device preset", exact: true }),
    option: (name: string) => page.getByRole("menuitemradio", { name, exact: true }),
    moreDevices: page.getByRole("menuitem", { name: "More devices", exact: true }),
    width: controls.getByLabel("Viewport width in CSS pixels", { exact: true }),
    height: controls.getByLabel("Viewport height in CSS pixels", { exact: true }),
    scale: controls.getByRole("button", { name: "Preview scale", exact: true }),
    rotate: controls.getByRole("button", { name: "Rotate viewport", exact: true }),
  }
}

function resizePane(root: Locator, width: number) {
  return root.locator("#browser-panel").evaluate((pane, width) => {
    if (!pane.parentElement) throw new Error("Missing pane container")
    pane.parentElement.style.width = `${width}px`
  }, width)
}

async function expectSize(native: Locator, width: number, height: number) {
  await expect(native).toHaveAttribute("data-width", String(width))
  await expect(native).toHaveAttribute("data-height", String(height))
}

test("zooms the page from the browser options in view and keeps its zoom in the address field", async ({ page }) => {
  const { root, controls, viewport, preset, option, scale } = viewportControls(page)
  await viewport.click()
  await preset.click()
  await option("Samsung Galaxy S26").click()
  await expect(preset).toHaveText("Samsung Galaxy S26")
  const options = root.getByRole("button", { name: "Browser options", exact: true })
  await options.click()
  await page.getByRole("menuitem", { name: /^Zoom in/ }).click()
  await expect(root.getByText("Zoom: 110", { exact: true })).toBeVisible()
  await expect(controls.getByRole("status")).toContainText("The page is using the pane size because page zoom changed.")
  await expect(preset).toBeDisabled()
  await expect(preset).toHaveText("Responsive")
  await expect(scale).toBeDisabled()
  // The menu covered the page with a still; it closes so the zoomed page shows at once.
  await expect(page.getByRole("menu")).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")

  const zoom = root.getByRole("button", { name: "110%", exact: true })
  await expect(zoom).toBeVisible()
  await zoom.click()
  await expect(root.getByText("Zoom: 100", { exact: true })).toBeVisible()
  await expect(zoom).toBeHidden()
  await expect(preset).toBeEnabled()
})

test("restores the full pane when the toolbar closes and keeps the selected device on reopen", async ({ page }) => {
  const { root, controls, viewport, preset, option, moreDevices, width, height } = viewportControls(page)

  const native = root.getByTestId("native-Alpha")

  const fullWidth = await native.getAttribute("data-width")

  const fullHeight = await native.getAttribute("data-height")

  if (!fullWidth || !fullHeight) throw new Error("Missing native page bounds")

  await viewport.click()
  await preset.press("ArrowDown")
  const menu = page.getByRole("menu")
  await expect(option("Responsive")).toBeChecked()
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Responsive",
    "Samsung Galaxy S26",
    "iPhone 18 Pro",
    "iPad / iPad Air 11″",
    "Laptop",
    "Desktop",
  ])
  // The rows show before the menu has the keyboard: until its first row is focused, a key still goes to the trigger.
  await expect(option("Responsive")).toBeFocused()
  await page.keyboard.press("End")
  await expect(moreDevices).toBeFocused()
  await page.keyboard.press("ArrowRight")
  const mini = option("iPad mini")
  await mini.click()
  await expect(preset).toHaveText("iPad mini")
  await expect(preset).toBeFocused()
  await expect(native).not.toHaveAttribute("data-width", fullWidth)
  await viewport.click()
  await expect(controls).toBeHidden()
  await expect(native).toHaveAttribute("data-width", fullWidth)
  await expect(native).toHaveAttribute("data-height", fullHeight)
  await expect(root.getByRole("separator", { name: "Resize viewport width" })).toBeHidden()
  await viewport.click()
  await expect(preset).toHaveText("iPad mini")
  await expect(width).toHaveValue("756")
  await expect(height).toHaveValue("1158")
  // Matching the preset's dimensions by hand still counts as Custom.
  await width.fill("700")
  await width.fill("756")
  await expect(preset).toHaveText("Custom")
  await preset.click()
  await expect(option("Custom")).toBeChecked()
  await moreDevices.hover()
  await expect(mini).not.toBeChecked()
})

test("fits an exact viewport while resizing and rejects invalid edits", async ({ page }) => {
  const { root, viewport, preset, option, scale, width, height } = viewportControls(page)

  const native = root.getByTestId("native-Alpha")
  await viewport.click()
  await expect(width).toHaveValue("624")
  await width.fill("1248")
  await expect(scale).toHaveText("Fit - 50%")
  await expect(width).toBeFocused()
  await height.fill("5")
  // Chromium needs whole native pixels: round the fitted height up.
  await expectSize(native, 624, 3)
  await expect(height).toBeFocused()

  await resizePane(root, 328)
  await expect(scale).toHaveText("Fit - 25%")
  await expectSize(native, 312, 2)
  await expect(width).toHaveValue("1248")
  await expect(height).toHaveValue("5")

  for (const edit of ["", "4097"]) {
    await width.fill(edit)
    await expect(width).toHaveValue(edit)
    await expect(width).toHaveAttribute("aria-invalid", "true")
    await expect(width).toHaveAccessibleDescription("Use whole numbers from 1 to 4096 for width and height.")
    await expectSize(native, 312, 2)
  }

  await width.blur()
  await expect(width).toHaveValue("1248")
  await expect(width).not.toHaveAttribute("aria-invalid", "true")
  await preset.click()
  await option("Responsive").click()
  await expect(preset).toHaveText("Responsive")
  await expect(width).toHaveValue("312")
  await expect(scale).toHaveText("Fit - 100%")
  await resizePane(root, 640)
  await expect(width).toHaveValue("624")
  await expect(native).toHaveAttribute("data-width", "624")
})

test("resizes a device with the RTL side grip by pointer and keyboard", async ({ page }) => {
  const { root, viewport, preset, option, scale, width, height } = viewportControls(page)
  await root.evaluate((element) => element.setAttribute("dir", "rtl"))
  await viewport.click()
  await preset.click()
  await option("Samsung Galaxy S26").click()
  await scale.click()
  await option("50%").click()
  await expectSize(root.getByTestId("native-Alpha"), 180, 390)
  const grip = root.getByRole("separator", { name: "Resize viewport width", exact: true })

  const box = await grip.boundingBox()

  if (!box) throw new Error("Missing viewport resize grip")
  const x = box.x + box.width / 2

  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 12, y)
  // Both edges move 12 screen pixels, or 24 guest CSS pixels each at 50% scale.
  await expect(width).toHaveValue("408")
  await expect(height).toHaveValue("780")
  await expect(preset).toHaveText("Custom")
  await expectSize(root.getByTestId("native-Alpha"), 204, 390)
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.locator('img[elementtiming="embed-snapshot"]')).toHaveCount(0)
  await page.mouse.up()

  const bottomGrip = root.getByRole("separator", { name: "Resize viewport height", exact: true })

  await expect(grip).toHaveCSS("outline-style", "none")
  await bottomGrip.press("Shift+Tab")
  await expect(grip).toBeFocused()
  await expect(grip).toHaveCSS("outline-offset", "-2px")
  await grip.press("Shift+ArrowRight")
  await expect(width).toHaveValue("398")

  await page.keyboard.press("Tab")
  await expect(bottomGrip).toBeFocused()
  await expect(bottomGrip).toHaveCSS("outline-offset", "-2px")
})

test("pins the responsive dimensions when a manual preview scale is selected", async ({ page }) => {
  const { root, viewport, preset, option, scale, width, height } = viewportControls(page)

  const native = root.getByTestId("native-Alpha")
  await viewport.click()
  await expect(width).toHaveValue("624")
  const responsiveHeight = await height.inputValue()
  await expect(scale).toHaveText("Fit - 100%")
  await scale.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Fit to pane",
    "50%",
    "75%",
    "100%",
    "125%",
    "150%",
    "200%",
  ])
  const fit = option("Fit to pane")
  await expect(fit).toBeChecked()
  const double = option("200%")
  await double.click()
  await resizePane(root, 400)
  await expect(scale).toHaveText("200%")
  await expect(preset).toHaveText("Custom")
  await expect(width).toHaveValue("624")
  await expect(height).toHaveValue(responsiveHeight)

  await width.fill("120")
  await height.fill("80")
  await expectSize(native, 240, 160)
  await scale.click()
  await expect(double).toBeChecked()
  await fit.click()
  await expect(scale).toHaveText("Fit - 100%")
  await expectSize(native, 120, 80)
})

test("keeps the selected device and its rotated viewport with its browser tab", async ({ page }) => {
  const { root, viewport, preset, moreDevices, option, width, height, scale, rotate } = viewportControls(page)

  const switchTab = root.getByRole("button", { name: "Switch browser tab", exact: true })
  await viewport.click()
  await scale.click()
  await option("50%").click()
  await preset.click()
  await moreDevices.hover()
  const pixel = option("Pixel 10")
  await pixel.click()
  await expect(preset).toHaveText("Pixel 10")
  await rotate.click()
  await expectSize(root.getByTestId("native-Alpha"), 462, 206)

  await switchTab.click()
  await expect(root.getByTestId("native-Second")).toHaveAttribute("data-visible", "true")
  await expect(preset).toHaveText("Responsive")
  await width.fill("200")
  await height.fill("180")
  const second = root.getByTestId("native-Second")
  await expectSize(second, 200, 180)
  await expect(scale).toHaveText("Fit - 100%")

  // Wrapping the toolbar moves the centered native view on both axes without changing its size.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const embed = root.locator('[data-component="browser-preview"] > div:first-child')

  const wide = await embed.boundingBox()
  await resizePane(root, 320)
  const narrow = await embed.boundingBox()

  if (!wide || !narrow) throw new Error("Missing preview bounds")
  expect(narrow.x).toBeLessThan(wide.x)
  expect(narrow.y).toBeGreaterThan(wide.y)
  await expect(second).toHaveAttribute("data-x", String(Math.round(narrow.x)))
  await expect(second).toHaveAttribute("data-y", String(Math.round(narrow.y)))
  await expectSize(second, 200, 180)

  await switchTab.click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(width).toHaveValue("924")
  await expect(height).toHaveValue("412")
  await expect(preset).toHaveText("Pixel 10")
  await expect(scale).toHaveText("50%")
  await preset.click()
  await moreDevices.hover()
  await expect(pixel).toBeChecked()
})

test("the zoom row sits on the lines the other rows use, and Left and Right move between its buttons", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Browser options", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Zoom in", exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const edges = await page.evaluate(() => {
    const menu = document.querySelector('[data-component="menu-v2-content"]')
    const group = menu?.querySelector('[role="group"][aria-labelledby]')

    const label = (text: string) => {
      const node = [...(menu?.querySelectorAll('[data-slot="menu-v2-item-content"]') ?? [])].find((item) => item.textContent?.trim() === text)?.firstChild
      const range = document.createRange()

      if (node) range.selectNodeContents(node)

      return range.getBoundingClientRect()
    }

    const right = (selector: string) => menu?.querySelector(selector)?.getBoundingClientRect().right

    return {
      labels: ["Zoom", "Copy link", "More tools"].map((text) => label(text).left),
      tops: ["Zoom", "100%"].map((text) => label(text).top),
      trailing: [right('[aria-label="Zoom in"]'), right('[data-component="keybind-v2"]'), right('[data-slot="menu-v2-item-chevron"]')],
      heights: [group, group?.previousElementSibling].map((row) => row?.getBoundingClientRect().height),
    }
  })

  expect(Math.abs(edges.labels[0]! - edges.labels[1]!)).toBeLessThan(0.5)
  expect(Math.abs(edges.labels[0]! - edges.labels[2]!)).toBeLessThan(0.5)
  expect(Math.abs(edges.tops[0]! - edges.tops[1]!)).toBeLessThan(0.5)
  expect(Math.abs(edges.trailing[0]! - edges.trailing[1]!)).toBeLessThan(0.5)
  expect(Math.abs(edges.trailing[0]! - edges.trailing[2]!)).toBeLessThan(0.5)
  expect(edges.heights[0]).toBe(edges.heights[1])

  // At 100% there is nothing to reset, so that button is skipped. Down walks the row's buttons in order, as it walks
  // every item.
  await page.getByRole("menuitem", { name: "Zoom out", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("menuitem", { name: "Zoom in", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("menuitem", { name: "Zoom in", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("menuitem", { name: "Zoom out", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "Copy link", exact: true })).toBeFocused()
})

test("shows a page dialog in the pane instead of the page, and answers it with Escape", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const native = root.getByTestId("native-Alpha")
  // The fixture's controls sit below the pane, outside the viewport.
  await root.getByRole("button", { name: "Page confirm", exact: true }).evaluate((element: HTMLElement) => element.click())
  const dialog = page.getByRole("alertdialog", { name: "alpha.example says" })
  await expect(dialog).toContainText("Discard the draft?")
  await expect(dialog).toContainText("1 more waiting")
  await expect(dialog.getByRole("checkbox", { name: "Stop this page from showing more messages" })).toBeVisible()
  // A page blocked in a dialog draws nothing: the native view hides, and the dialog sits over the page's box.
  await expect(native).toHaveAttribute("data-visible", "false")
  await expect(dialog.getByRole("button", { name: "OK", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(root.getByText('Answers: [{"kind":"dialog","accept":false,"text":"","stop":false}]', { exact: true })).toBeVisible()
  await expect(native).toHaveAttribute("data-visible", "true")
})

test("asks for a site's permission in a bar while the page stays usable", async ({ page }) => {
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

test("starts the bar's input protection over when the page asks again", async ({ page }) => {
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

test("an agent's show request gives its page's permission bar no press that was on its way to the person's", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  const once = bar.getByRole("button", { name: "Allow this time", exact: true })
  await expect(bar).toContainText("alpha.example wants to show notifications.")
  // The person's bar has been there long enough to answer, so only the change of tab can refuse the next press.
  await page.waitForTimeout(600)
  const target = (await once.boundingBox())!
  // The agent shows its own page, whose first request has the same kind and number as the one on screen. The press
  // lands where the person's Allow was, at once.
  await root.getByRole("button", { name: "Agent shows a page that asks", exact: true }).evaluate((element: HTMLElement) => element.click())
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
  await expect(root.getByText("Answers: []", { exact: true })).toBeVisible()
  await expect(bar).toContainText("second.example wants to use your camera.")
  // The tab's answers take no input while its page is held back, then a new press answers the request on screen, in its tab.
  await expect(async () => {
    await once.click({ timeout: 1_000 })
    await expect(root.getByText('Answered in: ["Second"]', { exact: true })).toBeVisible({ timeout: 200 })
  }).toPass()
})

test("an agent's show request leaves the keyboard where the person types, and its tab's bar answers no key or click meanwhile", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await page.keyboard.type("exa")
  await expect(address).toHaveValue(/exa$/)

  // In the page, in one task: the show request, then at once the keys and clicks that would answer its bar. Escape
  // and the close button answer "not now", which nothing but the reveal's guard holds back.
  const held = await root.getByRole("button", { name: "Agent shows a page that asks", exact: true }).evaluate((show: HTMLElement) => {
    show.click()
    const bar = document.querySelector<HTMLElement>('[data-component="browser-prompt"]')
    const buttons = Array.from(bar?.querySelectorAll("button") ?? [])
    buttons[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    buttons.forEach((button) => button.click())

    return buttons.length
  })

  expect(held).toBeGreaterThan(1)
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  await expect(bar).toContainText("second.example wants to use your camera.")
  await expect(root.getByText("Answers: []", { exact: true })).toBeVisible()

  // The person was typing an address: the rest of it goes to the address field, not to the window or the composer.
  await expect(address).toBeFocused()
  await page.keyboard.type("mple")
  await expect(address).toHaveValue(/mple$/)
  await expect(root.getByRole("textbox", { name: "Composer stand-in" })).toHaveValue("")
})

test("takes the keyboard from the window for a dialog and gives it back where it was", async ({ page }) => {
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

test("asks again for an agent's request without offering to keep the answer, and says why", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Agent permission request", exact: true }).evaluate((element: HTMLElement) => element.click())
  const bar = root.getByRole("alertdialog", { name: "Site permission request" })
  await expect(bar).toContainText("alpha.example wants to use your microphone.")
  await expect(bar).toContainText("The agent is working in this tab. Your answer applies this one time.")
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

test("asks for a page's prompt text and sends what the user typed", async ({ page }) => {
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

// What the key test below records in the page's window.
declare global {
  interface Window {
    keyLog: KeyboardEvent[]
    keyBehind: string[]
  }
}

test("keeps the keys inside a page prompt, and leaves them to the window once the keyboard is elsewhere", async ({ page }) => {
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

test("asks for a site's sign-in with its realm, says the last one failed, and keeps nothing on cancel", async ({ page }) => {
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

test("the options menu lists everyday actions first and the rest under More tools, where each still runs", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Seed history", exact: true }).click()
  await root.getByRole("button", { name: "Seed imported history", exact: true }).click()
  await expect(root.getByText(/^Visits: \S/)).toBeVisible()
  await expect(root.getByText("Main history: 59", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Browser options", exact: true }).click()
  // Find, the zoom row (out, the zoom itself, in), Copy link and Add page; then More tools; then settings.
  await expect(page.getByRole("menu").first().getByRole("menuitem")).toHaveText([
    /^Find in page/,
    "",
    "100%",
    "",
    "Copy link",
    "Add page to session",
    "More tools",
    "Browser settings",
  ])
  await expect(page.getByRole("group", { name: "Zoom", exact: true }).getByRole("menuitem")).toHaveCount(3)
  await page.getByRole("menuitem", { name: "More tools", exact: true }).click()
  await expect(page.getByRole("menu", { name: "More tools", exact: true }).getByRole("menuitem")).toHaveText([
    /^Toggle browser toolbar/,
    "Open in default browser",
    /^Reload without saved files/,
    "Clear history",
  ])
  // Clearing forgets the window's last pages and main's history, imported pages included.
  await page.getByRole("menuitem", { name: "Clear history", exact: true }).click()
  await expect(root.getByText("Visits:", { exact: true })).toBeVisible()
  await expect(root.getByText("Main history: 0", { exact: true })).toBeVisible()
  // Neither has a button in the bar.
  await expect(root.getByRole("button", { name: "Add page to session", exact: true })).toHaveCount(0)
  await expect(root.getByRole("button", { name: "Toggle browser toolbar", exact: true })).toHaveCount(0)
})

// The comment tool is a button in the bar. While it waits for a pick, the pane also says so in a status line for
// assistive technology, which these cases read.
function commentTool(root: Locator) {
  const button = root.getByRole("button", { name: "Comment on part of the page", exact: true })

  return {
    button,
    click: () => button.click(),
    picking: root.getByText("Click part of the page to comment on it. Press Escape to cancel.", { exact: true }),
  }
}

async function addPage(page: Page, root: Locator) {
  await root.getByRole("button", { name: "Browser options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Add page to session", exact: true }).click()
}
