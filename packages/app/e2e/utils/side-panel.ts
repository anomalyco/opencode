import { expect, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"

/** Opens the side panel's "Open file" launcher tab from the new tab view the strip's + opens. */
export async function openFileLauncher(panel: Locator) {
  await panel.getByRole("button", { name: "Add tab", exact: true }).click()
  await panel.getByRole("button", { name: /^Open file/ }).click()
}

/** Opens the file browser with its shortcut: it reuses the selected launcher, else opens another. */
export async function browseFiles(page: Page) {
  await page.keyboard.press("Control+Alt+P")
}

/** Opens the Review tab from the launcher an empty side panel lists. */
export async function openReviewLauncher(panel: Locator) {
  await panel.getByRole("button", { name: /^Review/ }).click()
}

/** Storage that restores the Review tab, selected, in each session's side strip, as the app writes it. */
export function reviewTabs(directory: string, ...sessions: string[]) {
  return {
    "opencode.global.dat:layout": {
      sessionTabs: Object.fromEntries(
        sessions.map((id) => [
          `local\u0000${base64Encode(directory)}/${id}`,
          { all: ["review:changes"], active: "review:changes" },
        ]),
      ),
    },
  }
}

type CloseProbe = { frames: string[]; done: boolean }

/**
 * Records what every painted frame of the side region's close shows, until it lands closed: the strip's tabs, `*` on
 * the selected one, and whether the tab's content shows, as painted `text` or a visible `selector`. Resolves to the
 * distinct frames in order once it lands.
 */
export async function probeClose(page: Page, content: { text: string } | { selector: string }) {
  await page.evaluate((content) => {
    const probe: CloseProbe = { frames: [], done: false }

    const visible = (element: Element | null | undefined) =>
      !!element?.checkVisibility() && element.getBoundingClientRect().height > 0

    const shown = (root: Element) => {
      if ("selector" in content) return [...root.querySelectorAll(content.selector)].some(visible)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent?.includes(content.text) && visible(node.parentElement)) return true

      return false
    }

    const sample = () => {
      const region = document.querySelector<HTMLElement>("#review-panel")

      if (!region || region.getBoundingClientRect().width === 0) return void (probe.done = true)

      if (region.getAttribute("aria-hidden") === "true") {
        const tabs = [...region.querySelectorAll<HTMLElement>('[role="tab"]')].map(
          (tab) =>
            `${tab.closest<HTMLElement>("[data-pane-tab]")?.dataset.paneTab ?? tab.textContent?.trim()}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`,
        )

        const frame = `${tabs.join(",")} | ${shown(region) ? "content" : "none"}`

        if (probe.frames.at(-1) !== frame) probe.frames.push(frame)
      }

      requestAnimationFrame(sample)
    }

    Object.assign(window, { e2eCloseProbe: probe })
    requestAnimationFrame(sample)
  }, content)

  // SAFETY: the evaluate above stored the probe on the window before the close.
  const probe = () => page.evaluate(() => (window as Window & { e2eCloseProbe?: CloseProbe }).e2eCloseProbe!)

  return async () => {
    await expect.poll(async () => (await probe()).done).toBe(true)

    return (await probe()).frames
  }
}
