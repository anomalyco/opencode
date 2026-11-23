import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/settings.fixture.tsx"),
  ui: source("../src/runtime/plugin/ui.tsx"),
  // The app's own confirmation dialog, which `Dialogs.confirm` shows, and the language it reads.
  dialogs: source("../src/runtime/plugin/dialogs.tsx"),
  language: source("../src/runtime/i18n/language.tsx"),
}

// Any story loads the app styles; the fixture mounts the real Settings > Browser page beside it. `target` is the entry
// a settings search or the command palette is revealing.
async function open(
  page: Page,
  options?: {
    target?: string
    extensions?: boolean
    installed?: boolean
    historyKept?: boolean
    clearFails?: boolean
    file?: { imported: number; failed: number } | "unreadable"
  },
) {
  await page.evaluate(
    async (input) => {
      const [{ mountBrowserSettings }, { ui }, { PluginConfirmDialog }, { LanguageProvider }] = await Promise.all([
        import(input.modules.fixture),
        import(input.modules.ui),
        import(input.modules.dialogs),
        import(input.modules.language),
      ])

      mountBrowserSettings({
        ui,
        host: { Confirm: PluginConfirmDialog, LanguageProvider },
        clearFails: input.options?.clearFails,
        target: input.options?.target,
        extensions: input.options?.extensions,
        installed: input.options?.installed,
        historyKept: input.options?.historyKept,
        file: input.options?.file,
      })
    },
    { modules, options },
  )

  const root = page.getByTestId("browser-settings-fixture")

  return {
    root,
    advanced: root.getByRole("button", { name: /^Advanced/ }),
    stored: root.getByTestId("browser-settings-stored"),
    data: root.getByRole("region", { name: "Browser data", exact: true }),
    // The red button, and the question it asks before anything is cleared.
    clear: root.getByRole("region", { name: "Browser data", exact: true }).getByRole("button", { name: "Clear browsing data", exact: true }),
    confirm: page.getByRole("dialog", { name: "Clear browsing data?", exact: true }),
    // How often main was asked to clear. The dialog is modal, so this is hidden from the accessibility tree meanwhile.
    clears: root.getByTestId("browser-settings-clears"),
    visits: root.getByTestId("browser-settings-visits"),
  }
}

story.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

story("a search that lands inside Advanced opens it once, and the person's toggle wins after that", async ({ page }) => {
  const view = await open(page, { target: "settings-browser-sites" })

  // Open for the visit, without the device remembering it.
  await expect(view.advanced).toHaveAttribute("aria-expanded", "true")
  await expect(view.stored).not.toContainText("advanced")

  // The search's target stays set for the whole visit: closing must still close.
  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "false")
  await expect(view.stored).toContainText('"advanced":false')

  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "true")
  await expect(view.stored).toContainText('"advanced":true')
  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "false")
})

story("no setting decides what an import brings: the import section has its browsers and no note, and Advanced no switch for it", async ({ page }) => {
  const view = await open(page, { target: "settings-browser-remote", extensions: true })
  const section = view.root.getByRole("region", { name: "Import from another browser", exact: true })

  // The section is its title and one row per browser, whose button opens the import dialog with its two boxes.
  await expect(section.getByRole("button", { name: "Import…", exact: true })).toHaveCount(2)
  await expect(section.locator("p")).toHaveCount(0)
  await expect(view.advanced).toHaveAttribute("aria-expanded", "true")
  // Advanced holds two switches, neither of them about importing.
  await expect(view.root.getByRole("switch")).toHaveCount(3)
  await expect(view.root.getByRole("switch", { name: /history/i })).toHaveCount(0)
  await expect(view.stored).not.toContainText("importHistory")
})

story("each switch is named by its row's title, and each row says what it does in one sentence", async ({ page }) => {
  const view = await open(page, { target: "settings-browser-remote", extensions: true })
  const row = (id: string) => view.root.locator(`[data-action="${id}"]`)

  // The switch's accessible name is the row's title, so a screen reader hears what the row shows.
  for (const [id, title, description] of [
    ["settings-browser-links", "Open links in OpenCode", "Hold Shift and click a link to use your default browser"],
    ["settings-browser-remote", "Share sign-ins with remote servers", "Only turn on for servers you trust, since they can access your signed\u2011in sites"],
    ["settings-browser-agent-pages", "Open browser automatically", "Show the tab when the agent opens a page or file for you"],
  ] as const) {
    await expect(row(id).locator('[data-slot="settings-row-title"]')).toHaveText(title)
    await expect(row(id).locator('[data-slot="settings-row-description"]')).toHaveText(description)
    await expect(row(id).getByRole("switch", { name: title, exact: true })).toHaveCount(1)
  }

  await expect(row("settings-browser-extensions").locator('[data-slot="settings-row-description"]')).toHaveText(
    "Install from the Chrome Web Store, Edge Add-ons, or your other browsers",
  )
  const sites = view.root.getByRole("region", { name: "Site permissions", exact: true })
  await expect(sites.locator('[data-slot="settings-row-title"]')).toHaveText("No saved permissions")
  await expect(sites.locator("p")).toHaveText("Agent and remote server tabs ask again. Clearing browsing data keeps saved permissions.")
})

story("the red button asks first: Cancel, Escape, Enter on Cancel and a click outside clear nothing, and the confirm clears once", async ({ page }) => {
  const view = await open(page, { target: "settings-browser-cookies" })
  const cancel = view.confirm.getByRole("button", { name: "Cancel", exact: true })
  const confirm = view.confirm.getByRole("button", { name: "Clear data", exact: true })

  await expect(view.data.getByText("0 cookies. Sign-ins are shared across sessions", { exact: true })).toBeVisible()
  await view.clear.click()
  // One title, one line, two buttons: no close button, as the app's other confirmations.
  await expect(view.confirm.getByText("This signs you out of all sites and deletes history in OpenCode, leaving your other browsers untouched.", { exact: true })).toBeVisible()
  await expect(view.confirm.getByRole("button")).toHaveText(["Cancel", "Clear data"])
  // As the app's destructive confirmations do, it opens on Cancel, so Enter does not clear by accident.
  await expect(cancel).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(confirm).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Enter")
  await expect(view.confirm).toHaveCount(0)
  await expect(view.clears).toHaveText("0")

  for (const dismiss of [
    () => cancel.click(),
    () => page.keyboard.press("Escape"),
    // Outside the dialog: the dimmed page behind it.
    () => page.mouse.click(8, 8),
  ]) {
    await view.clear.click()
    await expect(cancel).toBeFocused()
    await dismiss()
    await expect(view.confirm).toHaveCount(0)
    await expect(view.clears).toHaveText("0")
  }

  // Nothing ran: the row still shows the count, the window's last pages are there, and the button is ready again.
  await expect(view.data.getByText("0 cookies. Sign-ins are shared across sessions", { exact: true })).toBeVisible()
  await expect(view.visits).toHaveText("1")
  await expect(view.clear).toBeEnabled()

  // Confirmed, with a second press on its way: main is asked once, and the row says how it ended.
  await view.clear.click()
  await confirm.dblclick()
  await expect(view.confirm).toHaveCount(0)
  await expect(view.data.getByText("Cleared browsing data.", { exact: true })).toBeVisible()
  await expect(view.clears).toHaveText("1")
  await expect(view.visits).toHaveText("0")
})

story("a confirmed clear that left the history behind says so in its row", async ({ page }) => {
  const kept = await open(page, { target: "settings-browser-cookies", historyKept: true })

  await kept.clear.click()
  await kept.confirm.getByRole("button", { name: "Clear data", exact: true }).click()
  // The sign-ins and site data went, so the row does not call it failed; it says what stayed.
  await expect(kept.data.getByText("Cleared sign-ins and site data, but history could not be cleared.", { exact: true })).toBeVisible()
  await expect(kept.visits).toHaveText("0")
  await expect(kept.clear).toBeEnabled()
})

story("a confirmed clear that main rejects says that it could not clear, and can be tried again", async ({ page }) => {
  const view = await open(page, { target: "settings-browser-cookies", clearFails: true })

  await view.clear.click()
  await view.confirm.getByRole("button", { name: "Clear data", exact: true }).click()
  await expect(view.data.getByText("Couldn't clear browsing data. Try again.", { exact: true })).toBeVisible()
  await expect(view.clears).toHaveText("1")
  await expect(view.visits).toHaveText("1")
  await expect(view.clear).toBeEnabled()
})

// A cookie file is cookies, so its row counts them: the one place an import says "cookies".
for (const [name, file, line] of [
  ["a cookie file that came whole", { imported: 12, failed: 0 }, "Imported 12 cookies."],
  ["a cookie file that lost some", { imported: 12, failed: 3 }, "Imported 12 cookies, 3 skipped."],
  ["a cookie file that brought one", { imported: 1, failed: 1 }, "Imported 1 cookie, 1 skipped."],
  // No browser's data, and no browser to close: the line is about the file.
  ["a cookie file that cannot be read", "unreadable", "Could not read this file."],
] as const)
  story(`${name} says so in its row: ${line}`, async ({ page }) => {
    const view = await open(page, { target: "settings-browser-cookies", file })

    await expect(view.root.getByText("Import cookie file", { exact: true })).toBeVisible()
    await expect(view.root.getByText("Supports cookies.txt or JSON from browser extensions or Playwright", { exact: true })).toBeVisible()
    await view.root.getByRole("button", { name: "Choose file", exact: true }).click()
    await expect(view.root.getByText(line, { exact: true })).toBeVisible()
  })

story("Add an extension aligns controls without top clipping and switches cleanly into a confirmation step", async ({ page }) => {
  const view = await open(page, { extensions: true })

  // The row is "Add an extension", so its button is "Add", with its plus.
  const add = view.root.locator('[data-action="settings-browser-extensions"]').getByRole("button", { name: "Add", exact: true })
  await expect(add.locator("svg")).toHaveCount(1)
  await add.click()
  const dialog = page.getByRole("dialog", { name: "Add an extension" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("LastPass: Free Password Manager")).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // Top URL input and Add button sit inside the scrollable dialog body with clearance for borders and focus rings.
  const metrics = await dialog.evaluate((node) => {
    const body = node.querySelector('[data-slot="dialog-body"]')?.getBoundingClientRect()
    const title = node.querySelector('[data-slot="dialog-title"]')?.getBoundingClientRect()
    const closeSvg = node.querySelector('[data-slot="dialog-close-button"] svg')?.getBoundingClientRect()
    const input = node.querySelector('[data-component="text-input-v2"]')?.getBoundingClientRect()
    const topAdd = node.querySelector('[data-component="text-input-v2"]')?.parentElement?.querySelector("button")?.getBoundingClientRect()
    const browserHeading = Array.from(node.querySelectorAll("span")).find((el) => el.textContent === "From your browsers")?.getBoundingClientRect()
    const selectChevron = node.querySelector('[data-slot="select-v2-chevron"]')?.getBoundingClientRect()
    const devSummary = node.querySelector("details > summary")?.getBoundingClientRect()
    const done = node.querySelector('[data-slot="dialog-footer"] button')?.getBoundingClientRect()
    const rowButtons = Array.from(node.querySelectorAll('[data-slot="menu-scroll-content"] button')).map((el) => el.getBoundingClientRect())

    return {
      topClearanceInput: body && input ? Math.round(input.top - body.top) : -1,
      topClearanceButton: body && topAdd ? Math.round(topAdd.top - body.top) : -1,
      leftDeltas:
        title && input && browserHeading && devSummary
          ? [input.left - title.left, browserHeading.left - title.left, devSummary.left - title.left].map((value) => Math.round(value))
          : [],
      rightDeltas:
        done && closeSvg && topAdd && selectChevron
          ? [
              closeSvg.right - done.right,
              topAdd.right - done.right,
              selectChevron.right - done.right,
              ...rowButtons.map((box) => box.right - done.right),
            ].map((value) => Math.round(value))
          : [],
    }
  })

  expect(metrics.topClearanceInput).toBeGreaterThanOrEqual(4)
  expect(metrics.topClearanceButton).toBeGreaterThanOrEqual(4)
  expect(metrics.leftDeltas).toEqual([0, 0, 0])
  expect(metrics.rightDeltas.every((delta) => delta === 0)).toBe(true)

  // Clicking Add switches the whole dialog into a concise confirmation step without the browser list underneath.
  await dialog.getByRole("button", { name: "Add", exact: true }).nth(1).click()
  const confirm = page.getByRole("dialog", { name: 'Add "LastPass: Free Password Manager"?' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByText("It can:")).toBeVisible()
  await expect(confirm.getByText("Read and change every page you visit")).toBeVisible()
  await expect(confirm.getByText("See and change your sign-ins")).toBeVisible()
  await expect(confirm.getByText("May not fully work here")).toBeVisible()
  await expect(confirm.getByText("From your browsers")).toHaveCount(0)
  await expect(confirm.getByText("Details")).toHaveCount(0)
  await expect(confirm.getByText(/Copied from another browser/)).toHaveCount(0)

  // Cancel returns smoothly to the picker list.
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("dialog", { name: "Add an extension" })).toBeVisible()
  await expect(dialog.getByText("From your browsers")).toBeVisible()

  // Unsupported extensions offer "Add anyway" in the confirmation footer.
  await dialog.getByRole("button", { name: "Add anyway" }).click()
  const unsupported = page.getByRole("dialog", { name: 'Add "OpenCode Browse"?' })
  await expect(unsupported).toBeVisible()
  await expect(unsupported.getByText("Probably won't work here")).toBeVisible()
  await expect(unsupported.getByRole("button", { name: "Add anyway" })).toBeVisible()
  await unsupported.getByRole("button", { name: "Cancel" }).click()

  // Approving installs the extension and returns to the picker with status and updated row state.
  await dialog.getByRole("button", { name: "Add", exact: true }).nth(1).click()
  await confirm.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Add an extension" })).toBeVisible()
  await expect(dialog.getByRole("status")).toContainText("Added LastPass: Free Password Manager.")
  await expect(dialog.getByRole("button", { name: "Added" })).toBeDisabled()
})

story("installed extension rows stack compatibility under the name and align controls cleanly", async ({ page }) => {
  const view = await open(page, { extensions: true, installed: true })
  const section = view.root.locator('section.settings-section[aria-label="Extensions"]')

  await expect(section.getByText("May not fully work here")).toBeVisible()
  await expect(section.getByText("Probably won't work here")).toBeVisible()

  const metrics = await section.evaluate((node) => {
    const rows = Array.from(node.querySelectorAll('[data-component="settings-row"]')).slice(0, 3)

    return rows.map((row) => {
      const compatInControl = row.querySelector('[data-slot="settings-row-control"] [data-compatibility]') !== null
      const compatInCopy = row.querySelector('[data-slot="settings-row-copy"] [data-compatibility]') !== null
      const trash = row.querySelector('[data-slot="settings-row-control"] button')?.getBoundingClientRect()
      const toggle = row.querySelector('[data-slot="settings-row-control"] [data-component="switch"]')?.getBoundingClientRect()

      return {
        compatInControl,
        compatInCopy,
        trashLeft: trash ? Math.round(trash.left) : -1,
        toggleRight: toggle ? Math.round(toggle.right) : -1,
      }
    })
  })

  expect(metrics.every((row) => !row.compatInControl)).toBe(true)
  expect(metrics.map((row) => row.compatInCopy)).toEqual([true, true, false])
  expect(new Set(metrics.map((row) => row.trashLeft)).size).toBe(1)
  expect(new Set(metrics.map((row) => row.toggleRight)).size).toBe(1)
})
