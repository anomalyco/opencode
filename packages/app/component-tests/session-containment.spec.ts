import type { Locator, Page } from "@playwright/test"
import { expect, sourceURL, test } from "../../lab/playwright/test"

const fixture = sourceURL(new URL("./session-containment.fixture.tsx", import.meta.url))

const marker = "Containment sample"

// Authored layout and top-layer markup from the chat link security review (F2, its confirmation pass, and N3).
const inputs = {
  "block anchor card": `<a href="obsidian://open?vault=x" style="display:block;color:inherit;text-decoration:none;cursor:text;padding:400px 0"><div>${marker}: the whole answer</div></a>`,
  "fixed transparent anchor": `${marker}<a href="obsidian://open?vault=x" style="position:fixed;inset:0;opacity:0;z-index:2147483647">x</a>`,
  "popover cover": `${marker}<button popovertarget="user-content-p">Show details</button><div id="p" popover="manual" style="position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;background:#fff;color:#000;pointer-events:none">COVER</div>`,
  "invoker dialog": `${marker}<button command="show-modal" commandfor="user-content-d">Show details</button><dialog id="d" style="width:100vw;height:100vh;max-width:none;max-height:none;margin:0;background:#fff">COVER</dialog>`,
  "fixed tint": `${marker}<div style="position:fixed;inset:0;background:red;opacity:.4;pointer-events:none">x</div>`,
  "author-sized math": `${marker} $\\raisebox{-40em}{\\colorbox{white}{\\rule{60em}{30em}}}$`,
  // A math fence renders as display math, placed through the same slot as a $$ formula.
  "author-sized math fence": `${marker}\n\n\`\`\`math\n\\raisebox{-40em}{\\colorbox{white}{\\rule{60em}{30em}}}\n\`\`\`\n`,
}

const legitimate = `${marker}\n\n| West | East |\n| :-- | --: |\n| Lettuce | Ranch |\n\n<img width="96" alt="Sample image" src="https://example.invalid/sample.png">\n\n<span style="color:teal">Teal text</span>`

for (const delivery of ["text", "tool"] as const) {
  for (const [name, markup] of Object.entries(inputs)) {
    test(`keeps ${name} inside its message as ${delivery}`, async ({ mount, page }) => {
      const root = await open(page, mount, markup, delivery)

      if (name.endsWith("math fence")) await expect(root.locator(".katex-display")).toHaveCount(1)
      await press(root)
      await expectContained(page, root, delivery)
    })
  }

  test(`renders legitimate authored markup normally as ${delivery}`, async ({ mount, page }) => {
    const root = await open(page, mount, legitimate, delivery)
    await expect(root.locator("th").filter({ hasText: "East" })).toHaveAttribute("align", "right")
    await expect(root.locator('img[alt="Sample image"]')).toHaveAttribute("width", "96")
    await expect(root.locator('img[alt="Sample image"]')).toHaveJSProperty("width", 96)
    await expect(root.getByText("Teal text", { exact: true })).toHaveCSS("color", "rgb(0, 128, 128)")
    await expectContained(page, root, delivery)
  })
}

async function open(page: Page, mount: (id: string) => Promise<Locator>, markup: string, delivery: "text" | "tool") {
  await page.route("https://example.invalid/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=", "base64") }),
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await mount("ui-line-comment--editor")
  await page.evaluate(async ({ fixture, markup, delivery }) => {
    const { mountContainment } = await import(fixture)
    mountContainment(markup, delivery)
  }, { fixture, markup, delivery })
  await expect(page.getByTestId("containment-fixture").getByRole("button", { name: "Allow once" })).toBeVisible()

  return message(page, delivery)
}

// The tool output sits in a collapsed tool row.
async function message(page: Page, delivery: "text" | "tool") {
  const host = page.getByTestId("containment-fixture")
  const root = host.locator('[data-component="markdown"]').filter({ hasText: marker }).last()

  for (let step = 0; delivery === "tool" && step < 1 && !(await root.isVisible()); step++)
    await host.locator('button[data-slot="collapsible-trigger"][aria-expanded="false"]').filter({ hasText: "List" }).first().click()
  await expect(root).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  return root
}

// A person clicks whatever the message offers, as the cover recipes require.
async function press(root: Locator) {
  for (const button of await root.locator("button").all()) await button.click({ force: true, timeout: 2_000 }).catch(() => undefined)
}

async function expectContained(page: Page, root: Locator, delivery: "text" | "tool") {
  const host = page.getByTestId("containment-fixture")
  const dock = await frontmost(page, host.getByRole("button", { name: "Allow once" }))
  const contained = await layout(page, root)
  // Answered, the dock gives way to the composer in a fresh render of the same history; press the message again.
  await page.evaluate(async (fixture) => {
    const { answerPermission } = await import(fixture)
    answerPermission()
  }, fixture)
  const composer = host.locator('[data-component="composer-editor"]').first()
  await expect(composer).toBeVisible()
  await press(await message(page, delivery))

  expect({ ...contained, dock, composer: await frontmost(page, composer) }).toEqual({
    escaped: [],
    topLayer: 0,
    dock: true,
    composer: true,
  })
}

// Whether hit testing at the control's centre reaches the control first.
async function frontmost(page: Page, control: Locator) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const box = await control.boundingBox()

  if (!box) return false

  return control.evaluate((element, point) => element.contains(document.elementsFromPoint(point.x, point.y)[0] ?? null), {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  })
}

// Descendants painted outside the message, and message content in the top layer.
async function layout(page: Page, root: Locator) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  return root.evaluate((message) => {
    const bounds = message.getBoundingClientRect()

    // A descendant's painted area: its box, cut by every clipping ancestor inside the message.
    const painted = (node: Element) => {
      const box = node.getBoundingClientRect()
      const area = { left: box.left, top: box.top, right: box.right, bottom: box.bottom }

      for (let parent = node.parentElement; parent && parent !== message; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === "visible") continue
        const clip = parent.getBoundingClientRect()
        area.left = Math.max(area.left, clip.left)
        area.top = Math.max(area.top, clip.top)
        area.right = Math.min(area.right, clip.right)
        area.bottom = Math.min(area.bottom, clip.bottom)
      }

      return area
    }

    const escaped = Array.from(message.querySelectorAll("*"))
      .filter((node) => !node.closest(".katex-mathml"))
      .map((node) => ({ node, area: painted(node) }))
      .filter(({ area }) => area.right > area.left && area.bottom > area.top)
      .filter(({ area }) => area.left < bounds.left - 1 || area.top < bounds.top - 1 || area.right > bounds.right + 1 || area.bottom > bounds.bottom + 1)
      .map(({ node }) => node.localName)

    const topLayer = Array.from(document.querySelectorAll(":popover-open, dialog[open]")).filter((node) => message.contains(node)).length

    return { escaped: escaped.slice(0, 5), topLayer }
  })
}
