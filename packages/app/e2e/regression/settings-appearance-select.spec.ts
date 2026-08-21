import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_settings_appearance_select"
const directory = "C:/OpenCode/SettingsAppearanceSelect"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

async function openSettings(page: import("@playwright/test").Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_settings_appearance_select",
      worktree: directory,
      vcs: "git",
      name: "settings-appearance-select",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await page.keyboard.press("Control+Comma")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test("appearance selects keep reopening after switching", async ({ page }) => {
  const dialog = await openSettings(page)
  const scheme = dialog.locator('[data-action="settings-color-scheme"] [data-component="select-v2"]')
  const theme = dialog.locator('[data-action="settings-theme"] [data-component="select-v2"]')
  const listbox = page.locator('[data-slot="select-v2-listbox"]')

  const pick = async (trigger: typeof scheme, index: number) => {
    await trigger.click()
    await expect(listbox).toBeVisible()
    await listbox.locator("[role=option]").nth(index).click()
    await expect(listbox).toBeHidden()
  }

  await pick(scheme, 1)
  await pick(theme, 5)
  await pick(scheme, 2)
  await pick(theme, 9)

  await scheme.click()
  await expect(listbox).toBeVisible()
  await scheme.click()
  await expect(listbox).toBeHidden()
  await theme.click()
  await expect(listbox).toBeVisible()
})

test("a closing dropdown does not swallow clicks meant for the row it covers", async ({ page }) => {
  const dialog = await openSettings(page)
  const scheme = dialog.locator('[data-action="settings-color-scheme"] [data-component="select-v2"]')
  const theme = dialog.locator('[data-action="settings-theme"] [data-component="select-v2"]')

  await scheme.scrollIntoViewIfNeeded()
  await scheme.click()
  await expect(page.locator('[data-slot="select-v2-listbox"]')).toBeVisible()

  // Force the closing state the dropdown sits in until it is unmounted. That
  // unmount waits on the exit animation, which never completes while the window
  // is throttled or occluded — the dropdown must not capture clicks meanwhile.
  const probe = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('[data-slot="select-v2-content"]')
    const trigger = document.querySelector<HTMLElement>(
      '[data-action="settings-theme"] [data-component="select-v2"]',
    )
    if (!content || !trigger) throw new Error("appearance select is not rendered")
    content.removeAttribute("data-expanded")
    content.setAttribute("data-closed", "")
    const box = content.getBoundingClientRect()
    const target = trigger.getBoundingClientRect()
    const hit = document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)
    return {
      overlaps: target.top < box.bottom && target.bottom > box.top,
      pointerEvents: getComputedStyle(content).pointerEvents,
      blockedByDropdown: content.contains(hit),
      reachesTrigger: trigger.contains(hit),
    }
  })

  expect(probe.overlaps).toBe(true)
  expect(probe.pointerEvents).toBe("none")
  expect(probe.blockedByDropdown).toBe(false)
  expect(probe.reachesTrigger).toBe(true)

  // and the click really lands on the theme select
  await theme.click()
  await expect(theme).toHaveAttribute("data-expanded", "")
})
