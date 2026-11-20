import type { Locator, Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"
import type { Accessor, ParentProps } from "solid-js"
import type { Command, MenuItem } from "@opencode/plugin/gui"
import type { Item } from "../src/runtime/plugin/host"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/panel.fixture.tsx"),
  host: source("../src/runtime/plugin/host.tsx"),
  panels: source("../src/runtime/plugin/panels.tsx"),
  closed: source("../src/runtime/plugin/closed-tabs.ts"),
  language: source("../src/runtime/i18n/language.tsx"),
  browser: source("../../gui-plugins/src/browser/index.ts"),
  browserRenderer: source("../../gui-plugins/src/browser/renderer.tsx"),
  browserPanel: source("../../gui-plugins/src/browser/panel.tsx"),
  file: source("../../gui-plugins/src/file/index.ts"),
  fileRenderer: source("../../gui-plugins/src/file/renderer.tsx"),
  commands: source("../src/shell/commands/command.tsx"),
  pluginCommands: source("../src/runtime/plugin/commands.tsx"),
  sdk: source("../../plugin/src/gui/index.ts"),
  render: source("../src/runtime/plugin/render.tsx"),
  settings: source("../src/settings/model.tsx"),
  platform: source("../src/runtime/platform/platform.tsx"),
  solid: source("./plugin-host.fixture.tsx"),
  sessionTabs: source("../src/shell/state/session-tabs.ts"),
}

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app styles; the fixture mounts the real side region and plugins beside it.
  await mount("ui-line-comment--editor")
  await page.evaluate(async (modules) => {
    const [
      { mountBrowserRegion },
      host,
      panels,
      language,
      browser,
      file,
      commands,
      sdk,
      renderer,
      settings,
      platform,
      solid,
      closed,
      pluginCommands,
      sessionTabs,
    ] = await Promise.all([
      import(modules.fixture),
      import(modules.host),
      import(modules.panels),
      import(modules.language),
      import(modules.browser),
      import(modules.file),
      import(modules.commands),
      import(modules.sdk),
      import(modules.render),
      import(modules.settings),
      import(modules.platform),
      import(modules.solid),
      import(modules.closed),
      import(modules.pluginCommands),
      import(modules.sessionTabs),
      // Load the pane before mounting: Vite must not reload the page to optimize its dependencies mid-fixture.
      import(modules.browserPanel),
    ])

    const closedTabs = closed.createClosedTabs()
    mountBrowserRegion({
      LanguageProvider: language.LanguageProvider,
      PluginHostProvider: host.PluginHostProvider,
      usePluginHost: host.usePluginHost,
      createRegion: (region: Omit<Parameters<typeof panels.createRegion>[0], "closed" | "open">) =>
        panels.createRegion({ ...region, closed: closedTabs, open() {} }),
      definitions: [
        { ...browser.default, id: "browser", windowEntry: () => import(modules.browserRenderer) },
        { ...file.default, id: "file", windowEntry: () => import(modules.fileRenderer) },
      ],
      Shell: (props: ParentProps) =>
        solid.createComponent(platform.PlatformProvider, {
          value: { platform: "web", openExternal() {}, restart: async () => undefined, notify: async () => undefined },
          get children() {
            return solid.createComponent(settings.SettingsProvider, {
              get children() {
                return solid.createComponent(commands.CommandProvider, {
                  get children() {
                    return props.children
                  },
                })
              },
            })
          },
        }),
      Commands: (props: {
        close: () => void
        review: () => void
        newSession: () => void
        reopenSession: () => void
        reopenSide: () => void
        switchSession: () => void
        side: () =>
          | {
              keys: () => readonly string[]
              active: () => string | undefined
              select: (key: string) => void
              close: (key: string) => void
              focus: (event: Event) => boolean
              openNewTab: () => void
              closeNewTab: () => boolean
            }
          | undefined
        shortcut: (shortcut: Accessor<string>) => void
      }) => {
        const command = commands.useCommand()
        // As in the app, the session screen's focus listener starts after the shell's key listener.
        let inSide = (_event: Event) => false
        const owner = solid.getOwner()
        queueMicrotask(() => (inSide = solid.runWithOwner(owner, closed.createSideFocus)!))
        const pluginHost = host.usePluginHost()
        // What the side strip's + shows beside the browser item, through the host's own formatter.
        props.shortcut(() => {
          const item = pluginHost
            .items(sdk.MenuItem)
            .find(
              (entry: { plugin: string; value: MenuItem }) =>
                entry.plugin === "browser" && entry.value.menu === "session.panel",
            )?.value

          return item?.menu === "session.panel" && item.keybind ? command.keybind(item.keybind) : ""
        })

        // As the session's commands: ⌘T and ⌘W inside the side region, unless the focused panel binds the key there.
        const sideKey = (event: KeyboardEvent) =>
          !!props.side()?.focus(event) &&
          !pluginCommands.pluginClaims(pluginHost.items(sdk.Command), command.matches, event)

        command.register("fixture-session", () => [
          {
            id: "file.close",
            title: "Close side tab",
            keybind: "mod+w",
            when: sideKey,
            onSelect: () => {
              const side = props.side()
              const key = side?.active()

              if (side && !side.closeNewTab() && key) side.close(key)
            },
          },
          {
            id: "file.tab.new",
            title: "",
            keybind: "mod+t",
            when: sideKey,
            onSelect: () => props.side()?.openNewTab(),
          },
          {
            id: "tab.close",
            title: "Close session tab",
            keybind: "mod+w",
            onSelect: props.close,
          },
          {
            id: "tab.new",
            title: "New session",
            keybind: "mod+t,mod+n",
            onSelect: props.newSession,
          },
          { id: "tab.reopenClosed", title: "", keybind: "mod+shift+t", onSelect: props.reopenSession },
          {
            id: "file.tab.reopen",
            title: "",
            keybind: "mod+shift+t",
            when: (event: Event) => inSide(event),
            onSelect: props.reopenSide,
          },
          { id: "tab.2", title: "", keybind: "mod+2", hidden: true, onSelect: props.switchSession },
          ...closed.sideTabShortcuts({
            keys: () => props.side()?.keys() ?? [],
            active: () => props.side()?.active(),
            select: (key: string) => props.side()?.select(key),
            when: (event: Event) => inSide(event),
          }),
          {
            id: "review.toggle",
            title: "Toggle review",
            keybind: "mod+shift+r",
            onSelect: props.review,
          },
        ])
        // The story server aliases the app's command hook to a no-op. Bridge the real plugin contributions
        // to the real dispatcher imported by source URL, so the shortcut runs rather than its alias.
        command.register("fixture-plugins", () =>
          pluginHost.items(sdk.Command).map((item: Item<Command>) => {
            const scope = item.value.scope

            return {
              id: `${item.plugin}.${item.value.id}`,
              title: item.value.title,
              keybind: item.value.bind,
              disabled: item.value.enabled === false,
              hidden: item.value.hidden,
              editable: item.value.editable,
              when: scope
                ? (event: KeyboardEvent) => event.target instanceof Element && !!event.target.closest(scope)
                : undefined,
              onSelect: () => item.value.run(),
            }
          }),
        )

        return null
      },
      Contribution: renderer.Contribution,
      appendTab: sessionTabs.appendSessionTab,
    })
  }, modules)
})

story("routes an exact HTML file to the pane and reports an unavailable pane instead of opening a file preview", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  const open = root.getByRole("button", { name: "Open workspace HTML" })
  await open.click()
  await expect(root.getByText("file:///repo/report.html", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Pane away" }).click()
  await open.click()
  await expect(root.getByText(/Can't open this workspace file in the browser pane/)).toBeVisible()
  await expect(root.getByRole("tab", { name: "report.html" })).toHaveCount(0)
})

story("closes a blank browser tab from its address field without closing the session", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await expect(root.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")

  // Prove the scope while browser.close is still registered.
  await outside.focus()
  await outside.press("ControlOrMeta+w")
  await expect(root.getByTestId("session-state")).toHaveText("closed")
  await expect(root.getByTestId("browser-closes")).toHaveText("[]")
  await expect(root.getByRole("tab", { name: "New tab", exact: true })).toBeVisible()
  await outside.click()
  await expect(root.getByTestId("session-state")).toHaveText("open")

  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.fill("example.com")
  await expect(address).toBeFocused()
  await address.press("ControlOrMeta+w")
  await expect(root.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0)
  await expect(root.getByTestId("browser-closes")).toHaveText('["tab_33333333-3333-3333-3333-333333333333"]')
  await expect(root.getByTestId("session-state")).toHaveText("open")
})

story("toggles the element picker from the shortcut only inside the browser pane", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()

  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  // The comment tool has no button in the bar; while it waits for a pick, the pane says so in a status line.
  const picking = root.getByText("Click part of the page to comment on it. Press Escape to cancel.", { exact: true })
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  await address.press("ControlOrMeta+Shift+c")
  await expect(root.getByTestId("browser-inspects")).toHaveText("[]")

  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(address).not.toHaveValue("")

  await outside.focus()
  await outside.press("ControlOrMeta+Shift+c")
  await expect(picking).toHaveCount(0)
  await expect(root.getByTestId("browser-inspects")).toHaveText("[]")

  await address.click()
  await expect(address).toBeFocused()
  await address.press("ControlOrMeta+Shift+c")
  await expect(picking).toBeAttached()
  await expect(root.getByTestId("browser-inspects")).toHaveText(
    '[{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":true}]',
  )

  await address.press("ControlOrMeta+Shift+c")
  await expect(picking).toHaveCount(0)
  await expect(root.getByTestId("browser-inspects")).toHaveText(
    '[{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":true},{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":false}]',
  )
})

story("keeps in-page shortcuts in the editor and forwards toolbar, review and close shortcuts", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const mod = mac ? "Meta" : "Control"

  const editor = page
    .frameLocator('iframe[title="Browser page"]')
    .getByRole("textbox", { name: "Editor page input", exact: true })

  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

  // In-page shortcuts like ⌘K stay with the focused page.
  await editor.focus()
  await editor.press(`${mod}+k`)
  await expect(editor).toHaveValue("handled:k")

  const toggle = root.getByRole("button", { name: "Toggle browser toolbar", exact: true })
  await editor.press(`${mod}+Shift+m`)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(toggle).toBeFocused()
  await root.getByRole("button", { name: "Device preset", exact: true }).press("ArrowDown")
  await page.getByRole("menuitem", { name: "More devices", exact: true }).press("ArrowRight")
  await expect(page.getByRole("menuitemradio", { name: "iPhone SE", exact: true })).toBeFocused()
  await page.keyboard.press(`${mod}+Shift+m`)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveCSS("outline-style", "solid")
  await toggle.click()
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveCSS("outline-style", "none")
  await page.keyboard.press(`${mod}+Shift+m`)
  await expect(toggle).toHaveCSS("outline-style", "solid")

  // Shell shortcuts like ⌘⇧R and pane-scoped ⌘W are claimed before the page sees them.
  await editor.press(`${mod}+Shift+r`)
  await expect(root.getByTestId("review-toggles")).toHaveText("1")
  await editor.press(`${mod}+w`)
  await expect(editor).toHaveValue("handled:k")
  await expect(root.getByTestId("browser-closes")).toHaveText('["tab_33333333-3333-3333-3333-333333333333"]')
  await expect(root.getByTestId("session-state")).toHaveText("open")
})

story("the pane's toolbar shortcut works from inside the options menu's More tools", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) ? "Meta" : "Control"
  const toggle = root.getByRole("button", { name: "Toggle browser toolbar", exact: true })
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  // The submenu is a portal of its own, outside the pane: it must still count as the pane for the pane's shortcuts.
  await root.getByRole("button", { name: "Browser options", exact: true }).click()
  await page.getByRole("menuitem", { name: "More tools", exact: true }).press("ArrowRight")
  await expect(page.getByRole("menu", { name: "More tools", exact: true }).getByRole("menuitem").first()).toBeFocused()
  await page.keyboard.press(`${mod}+Shift+m`)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
})

story(
  "reopening the side panel focuses a blank tab's address and closing it returns to the composer",
  async ({ page }) => {
    const root = page.getByTestId("browser-region-fixture")
    const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
    const toggle = mac ? "Meta+Shift+r" : "Control+Shift+r"
    const address = root.getByRole("combobox", { name: "Browser address", exact: true })
    const composer = root.getByRole("textbox", { name: "Composer", exact: true })
    const side = root.getByTestId("side-state")

    await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Beta", exact: true }).click()
    await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Blank page", exact: true }).click()
    await expect(root.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")

    await composer.focus()
    await page.keyboard.press(toggle)
    await expect(side).toHaveText("closed")
    await page.keyboard.press(toggle)
    await expect(side).toHaveText("open")
    await expect(address).toBeFocused()
    await page.keyboard.press(toggle)
    await expect(side).toHaveText("closed")
    await expect(composer).toBeFocused()
  },
)

story("opens a browser tab with ⌘T inside the pane and a session everywhere else", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const mod = mac ? "Meta" : "Control"
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const editor = page.frameLocator('iframe[title="Browser page"]').getByRole("textbox", { name: "Editor page input" })
  const opens = root.getByTestId("browser-opens")
  const sessions = root.getByTestId("new-sessions")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  // The + advertises the browser launcher's own shortcut, whichever tab shows; ⌘T stays the pane's.
  await expect(root.getByTestId("add-shortcut")).toHaveText(mac ? "⌃⌘B" : "Ctrl+Alt+B")
  await outside.click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(root.getByTestId("add-shortcut")).toHaveText(mac ? "⌃⌘B" : "Ctrl+Alt+B")

  // Outside the pane the shell keeps ⌘T.
  await outside.focus()
  await outside.press(`${mod}+t`)
  await expect(sessions).toHaveText("1")
  await expect(opens).toHaveText("0")

  // Inside the pane it opens a browser tab instead.
  await address.focus()
  await address.press(`${mod}+t`)
  await expect(opens).toHaveText("1")

  // Dvorak's T sits on the physical K key: the shortcut follows the character, not the key position.
  await address.evaluate((element, meta) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        code: "KeyK",
        metaKey: meta,
        ctrlKey: !meta,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, mac)
  await expect(opens).toHaveText("2")

  // A focused page hands the reserved chord to the pane before it sees it.
  await editor.focus()
  await editor.press(`${mod}+t`)
  await expect(opens).toHaveText("3")
  await expect(sessions).toHaveText("1")

  // The Browser launcher's own chord reaches the app from the page too.
  await editor.focus()
  await editor.press(mac ? "Control+Meta+b" : "Control+Alt+b")
  await expect(opens).toHaveText("4")
})

story("⌘T and ⌘W follow focus: side tabs inside the side panel, session tabs elsewhere", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) ? "Meta" : "Control"
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const panel = page.locator("#review-panel")
  const editor = page.frameLocator('iframe[title="Browser page"]').getByRole("textbox", { name: "Editor page input" })
  const sessions = root.getByTestId("new-sessions")
  const opens = root.getByTestId("browser-opens")
  const newTab = root.getByTestId("side-new-tab")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:/)

  // In the main column the chords keep the session's tabs, and the side panel reads as unfocused.
  await outside.focus()
  await outside.press(`${mod}+t`)
  await expect(sessions).toHaveText("1")
  await expect(panel).not.toHaveAttribute("data-focused")

  // The page's focus, which reaches the app only as the pane's report, counts as the side panel's.
  await editor.click()
  await expect(panel).toHaveAttribute("data-focused")
  await editor.press(`${mod}+t`)
  await expect(opens).toHaveText("1")
  await expect(sessions).toHaveText("1")

  // A click on the side panel's own surface, nothing focusable, leaves focus on the panel: ⌘T opens its new tab view
  // and ⌘W closes that view, then the selected tab.
  await panel.getByTestId("selected").click()
  await expect(panel).toHaveAttribute("data-focused")
  await page.keyboard.press(`${mod}+t`)
  await expect(newTab).toHaveText("shown")
  await page.keyboard.press(`${mod}+w`)
  await expect(newTab).toHaveText("none")
  await expect(root.getByTestId("browser-closes")).toHaveText("[]")
  await page.keyboard.press(`${mod}+w`)
  await expect(root.getByTestId("browser-closes")).toHaveText(/^\["tab_/)
  await expect(root.getByTestId("session-state")).toHaveText("open")
  await expect(sessions).toHaveText("1")
})

story("⌘L selects the browser address from the page and the pane, and nowhere else", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) ? "Meta" : "Control"
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const editor = page.frameLocator('iframe[title="Browser page"]').getByRole("textbox", { name: "Editor page input" })

  const selected = () =>
    address.evaluate(
      (input: HTMLInputElement) =>
        document.activeElement === input &&
        input.value.length > 0 &&
        input.selectionStart === 0 &&
        input.selectionEnd === input.value.length,
    )

  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:/)

  // In the main column ⌘L does not reach into the side panel.
  await outside.focus()
  await outside.press(`${mod}+l`)
  await expect(address).not.toBeFocused()

  // A focused page hands ⌘L to the pane, as it does ⌘T and ⌘W, without typing it.
  await editor.click()
  await editor.press(`${mod}+l`)
  await expect.poll(selected).toBe(true)
  await expect(editor).not.toHaveValue(/l$/)

  // On the pane's own surface too.
  await page.locator('#browser-panel [data-component="browser-bar"]').click({ position: { x: 2, y: 2 } })
  await expect(address).not.toBeFocused()
  await page.keyboard.press(`${mod}+l`)
  await expect.poll(selected).toBe(true)
})

story("keeps ⌘T in the browser pane after a click on its loading surface", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) ? "Meta" : "Control"
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:/)

  // A page still loading shows the pane's own surface where the native page goes; clicking it must not drop focus
  // to the side panel around the pane, where ⌘T would open the region's new tab view instead of a browser tab.
  await page.locator('#browser-panel [data-component="browser-bar"]').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press(`${mod}+t`)
  await expect(root.getByTestId("browser-opens")).toHaveText("1")
  await expect(root.getByTestId("side-new-tab")).toHaveText("none")
  await expect(root.getByTestId("new-sessions")).toHaveText("0")
})

story("reloads the browser tab with ⌘R inside the pane and leaves it to the window elsewhere", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const reloads = root.getByTestId("browser-reloads")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

  // Returns whether the chord stays unhandled, so it reaches the window's Reload menu item.
  const press = (target: typeof outside) =>
    target.evaluate(
      (element, meta) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "r",
            code: "KeyR",
            metaKey: meta,
            ctrlKey: !meta,
            bubbles: true,
            cancelable: true,
          }),
        ),
      mac,
    )

  expect(await press(outside)).toBe(true)
  await expect(reloads).toHaveText("0")

  expect(await press(address)).toBe(false)
  await expect(reloads).toHaveText("1")
})

story("keeps blank browser tabs when adding tabs and selecting another panel", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await expect(root.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")

  await address.press(`${mac ? "Meta" : "Control"}+t`)
  const tabs = root.getByRole("tab", { name: "New tab", exact: true })
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(root.getByTestId("browser-closes")).toHaveText("[]")

  // Selecting a different panel must not treat blank browser tabs as disposable placeholders.
  await address.press(`${mac ? "Meta" : "Control"}+1`)
  await expect(root.getByRole("tab", { name: "beta.ts", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(tabs).toHaveCount(2)
  await expect(root.getByTestId("browser-closes")).toHaveText("[]")
})

story("a new tab request that opened no blank tab leaves a later blank page's address alone", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const composer = root.getByRole("textbox", { name: "Composer", exact: true })
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

  // Main answers this request without a new blank tab.
  await address.press(`${mac ? "Meta" : "Control"}+t`)
  await expect(root.getByTestId("browser-opens")).toHaveText("1")

  // The page the agent blanks later must not take focus from the composer; a dispatched click leaves focus in place.
  await composer.focus()
  await root.getByRole("button", { name: "Blank page", exact: true }).dispatchEvent("click")
  await expect(root.getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(composer).toBeFocused()
})

story("reopens a closed browser tab with ⌘⇧T after the side panel and a session tab elsewhere", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const editor = page.frameLocator('iframe[title="Browser page"]').getByRole("textbox", { name: "Editor page input" })
  const opens = root.getByTestId("browser-opens")

  // Dvorak's T sits on the K key; the pane dispatches a focused page's keys on its root.
  const reopen = (target = "body") =>
    page.evaluate(
      ([selector, meta]) => {
        const init = { key: "T", code: "KeyK", shiftKey: true, metaKey: meta, ctrlKey: !meta, bubbles: true }
        document.querySelector(selector)?.dispatchEvent(new KeyboardEvent("keydown", init))
      },
      [target, mac] as const,
    )

  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

  // A native page takes focus without a DOM event, so the forwarded key itself places ⌘⇧T in the side panel.
  await outside.click()
  await reopen("#browser-panel")

  // The page hands ⌘W to the pane; the pane and the page go, leaving no focus.
  await editor.press(`${mac ? "Meta" : "Control"}+w`)
  await expect(root.getByTestId("selected")).toHaveText("file://beta.ts")

  await reopen()
  await expect(opens).toHaveText("1")

  // Once the user is outside the side panel, ⌘⇧T reopens a session tab again.
  await outside.click()
  await reopen()
  await expect(root.getByTestId("session-reopens")).toHaveText("1")
  await expect(opens).toHaveText("1")
})

story("selects side tabs with ⌘1–9 and ⇧⌘[ ] inside the side panel and session tabs elsewhere", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) ? "Meta" : "Control"
  const outside = root.getByRole("button", { name: "Beta", exact: true })
  const panel = page.locator("#review-panel")
  const editor = page.frameLocator('iframe[title="Browser page"]').getByRole("textbox", { name: "Editor page input" })
  const selected = root.getByTestId("selected")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await outside.click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(selected).toHaveText(/^browser:/)

  // A native page takes focus without a DOM event; the key it forwards still lands in the side panel.
  await outside.click()
  await editor.press(`${mod}+1`)
  await expect(selected).toHaveText("file://beta.ts")

  await panel.press(`${mod}+2`)
  await expect(selected).toHaveText(/^browser:/)
  await panel.press(`${mod}+1`)
  await expect(selected).toHaveText("file://beta.ts")
  await panel.press(`${mod}+9`)
  await expect(selected).toHaveText(/^browser:/)
  await editor.press(`${mod}+Shift+BracketLeft`)
  await expect(selected).toHaveText("file://beta.ts")
  await panel.press(`${mod}+Shift+BracketRight`)
  await expect(selected).toHaveText(/^browser:/)
  await expect(root.getByTestId("session-switches")).toHaveText("0")

  await outside.focus()
  await outside.press(`${mod}+2`)
  await expect(root.getByTestId("session-switches")).toHaveText("1")
  await expect(selected).toHaveText(/^browser:/)
})

story("keeps a restored browser tab with no saved page selected and undrawn until the desktop's first inventory", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await expect(tabs).toHaveText(["alpha.ts"])

  // Beta was left on its browser tab, which the desktop has not reported yet and no earlier run saved a title for.
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:tab_/)
  await expect(tabs).toHaveText(["beta.ts"])

  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(tabs).toHaveText(["beta.ts", "Preview"])
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
})

// What main sends for Beta's two tabs, as production builds it: the inventory `pane-machine.ts` publishes and the page
// details `chromium.ts` reports. `electron-restore.test.ts` reads the titles a restored page publishes in real Electron.
type MainTab = {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  generation: number
}

// The fixture reads each one through the pane Ipc's own event schema, so a shape main cannot send fails there.
type MainEvent =
  | { type: "state"; state: { tabs: MainTab[]; focusedTabID: string } | null; error?: string; unnamed?: string[]; placed?: { tabID: string; after: string } }
  | { type: "page"; tabID: string; zoom: number; viewport: { mode: "auto" }; icon?: string }
  | { type: "embed"; tabID: string; embed: string }
  | { type: "focus"; tabID: string }

const preview = "tab_33333333-3333-3333-3333-333333333333"

const docs = "tab_66666666-6666-6666-6666-666666666666"

// A page's icon, as the data URL main reports.
const icon = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='${fill}'/%3E%3C/svg%3E`

const previewIcon = icon("teal")

const docsIcon = icon("orange")

const reported = (tab: Pick<MainTab, "id" | "url" | "title"> & Partial<MainTab>): MainTab => ({
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
  ...tab,
})

const inventory = (...tabs: MainTab[]): MainEvent => ({ type: "state", state: { tabs, focusedTabID: preview } })

const details = (tabID: string, icon?: string): MainEvent =>
  icon
    ? { type: "page", tabID, zoom: 1, viewport: { mode: "auto" }, icon }
    : { type: "page", tabID, zoom: 1, viewport: { mode: "auto" } }

// The tabs as main restores them: saved by id and address, their pages not loaded, so neither reports a title.
const restoredPreview = reported({ id: preview, url: "http://localhost:4173/", title: "", generation: 1 })

const restoredDocs = reported({ id: docs, url: "https://example.com/docs", title: "", generation: 1 })

const send = async (root: Locator, event: MainEvent) => {
  await root.getByRole("textbox", { name: "Main event", exact: true }).fill(JSON.stringify(event))
  await root.getByRole("button", { name: "Send main event", exact: true }).dispatchEvent("click")
}

// Each strip tab's box, label and icon, as drawn now.
const drawn = (tabs: Locator) =>
  tabs.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()

      return { x: box.x, width: box.width, text: node.textContent, icon: node.querySelector("img")?.getAttribute("src") ?? "none" }
    }),
  )

// Beta with two loaded browser tabs beside its file tab, then the app quits and opens again.
const reopen = async (page: Page, quit: () => Promise<void> = async () => {}) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await send(root, inventory(reported({ id: preview, url: "http://localhost:4173/", title: "Preview" }), reported({ id: docs, url: "https://example.com/docs", title: "Docs" })))
  await send(root, details(preview, previewIcon))
  await send(root, details(docs, docsIcon))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs"])
  await quit()
  await root.getByRole("button", { name: "Quit and reopen", exact: true }).dispatchEvent("click")
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs"])
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(root.getByRole("status", { name: "Loading", exact: true })).toBeVisible()
  const first = await drawn(tabs)
  const nodes = await tabs.elementHandles()

  // The same boxes, labels and icons as the first frame after the reopen, in the same elements: nothing moved.
  const stable = async () => {
    expect(await drawn(tabs)).toEqual(first)
    expect(
      await page.evaluate(
        ([before, after]) => before.length === after.length && before.every((node, index) => node === after[index]),
        [nodes, await tabs.elementHandles()],
      ),
    ).toBe(true)
  }

  return { root, first, stable }
}

// After a restart the strip showed no browser tab until the desktop had attached, and then each tab changed its label,
// and so its width and the place of every tab after it, as its page loaded: saved title, address, title again.
story("holds every restored tab's box, label and icon from the reopen until its page has loaded", async ({ page }) => {
  // The pane's Ipc is still starting when the window draws its first frame.
  const { root, first, stable } = await reopen(page, () => page.getByTestId("browser-region-fixture").getByRole("button", { name: "Pane away", exact: true }).click())
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()

  await root.getByRole("button", { name: "Pane back", exact: true }).click()
  await expect(root.getByText("Registrations: 3", { exact: true })).toBeVisible()
  await stable()

  // Main attached and restored both tabs. Docs is never selected, so its page never loads and it never reports a title.
  await send(root, inventory(restoredPreview, restoredDocs))
  await expect(address).toHaveValue("http://localhost:4173/")
  await expect(root.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0)
  await stable()

  // The pane shows Preview, so main creates its page, which starts to load.
  await send(root, { type: "embed", tabID: preview, embed: "embed-preview" })
  await send(root, inventory({ ...restoredPreview, loading: true }, restoredDocs))
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await stable()

  // The document commits where its address redirected to, with no title and no icon yet.
  const committed = { ...restoredPreview, url: "http://localhost:4173/app", loading: true }
  await send(root, inventory(committed, restoredDocs))
  await send(root, details(preview))
  await expect(address).toHaveValue("http://localhost:4173/app")
  await stable()

  // It names itself, its icon arrives, and it stops loading.
  await send(root, inventory({ ...committed, title: "Preview" }, restoredDocs))
  await stable()
  await send(root, details(preview, previewIcon))
  await stable()
  await send(root, inventory({ ...committed, title: "Preview", loading: false }, restoredDocs))
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeVisible()
  await stable()
  // What held all along is the saved icon of each page, not the globe.
  expect(first.map((tab) => tab.icon)).toEqual([expect.any(String), previewIcon, docsIcon])
})

// A tab a link opened was added at the end of the strip, after every other tab, however far from the tab it came from.
// Now it appears at the click, beside that tab, as in Chrome. The strip sizes a tab by its label, so the tabs after it
// move when it appears and when it takes its page's title, and at no other step: it keeps its new-tab label while its
// page loads and has only Chromium's name for it, its address, which would move them a third time.
type Box = Awaited<ReturnType<typeof drawn>>[number]

// `after` is `before` with one tab added at `index`: it takes the place of the tab that stood there, every tab after it
// moves right by its width and the strip's gap, and no other tab moves or changes width, label or icon.
const expectInserted = (before: Box[], after: Box[], index: number) => {
  const gap = before[1].x - before[0].x - before[0].width
  const added = after[index]
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, index)).toEqual(before.slice(0, index))
  expect(added.x).toBeCloseTo(before[index]?.x ?? before[index - 1].x + before[index - 1].width + gap, 3)
  after.slice(index + 1).forEach((tab, offset) => {
    const earlier = before[index + offset]
    expect({ ...tab, x: 0 }).toEqual({ ...earlier, x: 0 })
    expect(tab.x).toBeCloseTo(earlier.x + added.width + gap, 3)
  })
}

// `after` is `before` with the tab at `index` relabelled `text`: it stays where it stood with another width, every tab
// after it moves by that difference, and no other tab moves or changes width, label or icon.
const expectRenamed = (before: Box[], after: Box[], index: number, text: string) => {
  const grown = after[index].width - before[index].width
  expect(after.length).toBe(before.length)
  expect(after.slice(0, index)).toEqual(before.slice(0, index))
  expect(after[index]).toEqual({ ...before[index], text, width: after[index].width })
  expect(grown).not.toBe(0)
  after.slice(index + 1).forEach((tab, offset) => {
    const earlier = before[index + 1 + offset]
    expect({ ...tab, x: 0 }).toEqual({ ...earlier, x: 0 })
    expect(tab.x).toBeCloseTo(earlier.x + grown, 3)
  })
}

// Beta with three loaded browser tabs after its file tab, and Docs, the middle one, in front.
const linkStrip = async (page: Page) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  const first = reported({ id: preview, url: "http://localhost:4173/", title: "Preview" })
  const middle = reported({ id: docs, url: "https://example.com/docs", title: "Docs" })
  const last = reported({ id: "tab_77777777-7777-7777-7777-777777777777", url: "https://example.com/guide", title: "Guide" })
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await send(root, inventory(first, middle, last))
  await root.getByRole("tab", { name: "Docs", exact: true }).click()
  await expect(root.getByTestId("selected")).toHaveText(`browser:${docs}`)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  expect((await drawn(tabs)).map((tab) => tab.text)).toEqual(["beta.ts", "Preview", "Docs", "Guide"])

  // Main's inventory with `opened` between Docs and Guide, as it reports it (`publish` in pane-machine.ts).
  const listed = (opened: MainTab[], rest: { unnamed?: string[]; placed?: { tabID: string; after: string }; focusedTabID?: string } = {}) => ({
    type: "state" as const,
    state: { tabs: [first, middle, ...opened, last], focusedTabID: rest.focusedTabID ?? docs },
    ...(rest.unnamed && { unnamed: rest.unnamed }),
    ...(rest.placed && { placed: rest.placed }),
  })

  return { root, tabs, listed, selected: root.getByTestId("selected") }
}

// What a tab a link opened reports, in order, as measured in Electron: blank, its load starts, its document commits
// under Chromium's name for it, the document names itself, and the load ends.
const linkPage = (id: string, path: string, title: string) => {
  const blank = reported({ id, url: "about:blank", title: "" })
  const committed = { ...blank, url: `https://example.com/${path}`, title: `example.com/${path}`, loading: true, generation: 1 }

  return { id, blank, started: { ...blank, loading: true }, committed, named: { ...committed, title }, ended: { ...committed, title, loading: false } }
}

story("a tab a link opens behind appears at once beside the tab it came from, and its page's title is its only other change", async ({ page }) => {
  const { root, tabs, listed, selected } = await linkStrip(page)
  const one = linkPage("tab_88888888-8888-8888-8888-888888888888", "one", "One")
  const two = linkPage("tab_99999999-9999-9999-9999-999999999999", "two", "Second page")
  const three = linkPage("tab_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "three", "Three")
  const before = await drawn(tabs)

  // The person middle-clicks a link in Docs: the tab appears at once, after Docs, behind it.
  await send(root, listed([one.blank], { placed: { tabID: one.id, after: docs }, unnamed: [one.id] }))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "New tab", "Guide"])
  const shown = await drawn(tabs)
  expectInserted(before, shown, 3)

  // Its load starts and its document commits, with Chromium's name for it: no box moves or changes width or label.
  for (const waiting of [one.started, one.committed]) {
    await send(root, listed([waiting], { unnamed: [one.id] }))
    expect(await drawn(tabs)).toEqual(shown)
  }

  // Its document names itself: the tab takes that name, where it stands.
  await send(root, listed([one.named]))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "Guide"])
  const named = await drawn(tabs)
  expectRenamed(shown, named, 3, "One")
  // Its icon arrives and its load ends: no box moves or changes width.
  await send(root, details(one.id, docsIcon))
  await expect(root.getByRole("tab", { name: "One", exact: true }).locator("img")).toHaveAttribute("src", docsIcon)
  await send(root, listed([one.ended]))
  const loaded = await drawn(tabs)
  expect(loaded).toEqual([...named.slice(0, 3), { ...named[3], icon: docsIcon }, named[4]])
  await expect(selected).toHaveText(`browser:${docs}`)

  // Two more middle-clicks in a row: each appears at its click, in the order they were opened, after One.
  await send(root, listed([one.ended, two.blank], { placed: { tabID: two.id, after: one.id }, unnamed: [two.id] }))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "New tab", "Guide"])
  const second = await drawn(tabs)
  expectInserted(loaded, second, 4)
  await send(root, listed([one.ended, two.started, three.blank], { placed: { tabID: three.id, after: two.id }, unnamed: [two.id, three.id] }))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "New tab", "New tab", "Guide"])
  const third = await drawn(tabs)
  expectInserted(second, third, 5)
  await send(root, listed([one.ended, two.started, three.started], { unnamed: [two.id, three.id] }))
  await send(root, listed([one.ended, two.committed, three.committed], { unnamed: [two.id, three.id] }))
  expect(await drawn(tabs)).toEqual(third)
  // The second one's page is named first: only it is relabelled, and only Guide moves.
  await send(root, listed([one.ended, two.committed, three.named], { unnamed: [two.id] }))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "New tab", "Three", "Guide"])
  const reversed = await drawn(tabs)
  expectRenamed(third, reversed, 5, "Three")
  // Then the first one's: Three and Guide move once more, for this tab.
  await send(root, listed([one.ended, two.named, three.named]))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "Second page", "Three", "Guide"])
  const ordered = await drawn(tabs)
  expectRenamed(reversed, ordered, 4, "Second page")
  await send(root, listed([one.ended, two.ended, three.ended]))
  expect(await drawn(tabs)).toEqual(ordered)
  await expect(selected).toHaveText(`browser:${docs}`)

  // The app quits and opens again: the strip draws the same order at once, and main's restored tabs move nothing.
  await root.getByRole("button", { name: "Quit and reopen", exact: true }).dispatchEvent("click")
  await expect(root.getByText("Registrations: 3", { exact: true })).toBeVisible()
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "One", "Second page", "Three", "Guide"])
  expect(await drawn(tabs)).toEqual(ordered)
  const restored = listed([one.ended, two.ended, three.ended])
  await send(root, { ...restored, state: { ...restored.state, tabs: restored.state.tabs.map((tab) => ({ ...tab, title: "", generation: 1 })) } })
  await expect(root.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0)
  expect(await drawn(tabs)).toEqual(ordered)
  await expect(selected).toHaveText(`browser:${docs}`)
})

story("a tab a link opens in front appears at once, selected, beside the tab it came from, and its page's title is its only other change", async ({ page }) => {
  const { root, tabs, listed, selected } = await linkStrip(page)
  const front = linkPage("tab_88888888-8888-8888-8888-888888888888", "front", "In front")
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  const before = await drawn(tabs)

  // The person clicks a `target="_blank"` link in Docs: main lists the tab after Docs and brings it to the front, in
  // that order (`tab.opened`, then `tab.focused`, in pane-machine.ts).
  await send(root, listed([front.blank], { placed: { tabID: front.id, after: docs }, unnamed: [front.id] }))
  await send(root, listed([front.blank], { unnamed: [front.id], focusedTabID: front.id }))
  await send(root, { type: "focus", tabID: front.id })
  await expect(selected).toHaveText(`browser:${front.id}`)
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "New tab", "Guide"])
  const shown = await drawn(tabs)
  expectInserted(before, shown, 3)

  // Its load starts and its document commits: the pane shows the address, and no box moves or changes width or label.
  await send(root, listed([front.started], { unnamed: [front.id], focusedTabID: front.id }))
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  expect(await drawn(tabs)).toEqual(shown)
  await send(root, listed([front.committed], { unnamed: [front.id], focusedTabID: front.id }))
  await expect(address).toHaveValue("https://example.com/front")
  expect(await drawn(tabs)).toEqual(shown)

  // Its document names itself: the tab takes that name, where it stands.
  await send(root, listed([front.named], { focusedTabID: front.id }))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs", "In front", "Guide"])
  const named = await drawn(tabs)
  expectRenamed(shown, named, 3, "In front")
  await send(root, details(front.id, docsIcon))
  await expect(root.getByRole("tab", { name: "In front", exact: true }).locator("img")).toHaveAttribute("src", docsIcon)
  await send(root, listed([front.ended], { focusedTabID: front.id }))
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeVisible()
  expect(await drawn(tabs)).toEqual([...named.slice(0, 3), { ...named[3], icon: docsIcon }, named[4]])
  await expect(selected).toHaveText(`browser:${front.id}`)
})

// A page's icon arrives after its tab is drawn: Chromium lists it once the document's head has parsed, and main loads
// it. The tab draws the globe until then. A site's SVG is drawn as an image, never put in the window as markup.
story("a tab draws its page's icon in the globe's place as an image, and no tab moves", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await send(root, inventory(reported({ id: preview, url: "http://localhost:4173/", title: "Preview" }), reported({ id: docs, url: "https://example.com/docs", title: "Docs" })))
  await expect(tabs).toHaveText(["beta.ts", "Preview", "Docs"])
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const globes = await drawn(tabs)
  expect(globes.slice(1).map((tab) => tab.icon)).toEqual(["none", "none"])

  // A site's own SVG that would run as markup: a script, and a handler on the element itself.
  const hostile = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" onload="window.iconRan = 'onload'"><script>window.iconRan = 'script'</script><rect width="16" height="16" fill="purple"/></svg>`).toString("base64")}`
  const image = root.getByRole("tab", { name: "Docs", exact: true }).locator("img")
  await send(root, details(preview, previewIcon))
  await send(root, details(docs, hostile))
  await expect(image).toHaveAttribute("src", hostile)
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  expect(await page.evaluate(() => "iconRan" in window)).toBe(false)
  expect(await drawn(tabs)).toEqual([globes[0], { ...globes[1], icon: previewIcon }, { ...globes[2], icon: hostile }])
})

// A server without a browser left its restored tabs on a loader with no end.
story("a restored tab on a server without a browser says that the browser could not open, and keeps its box", async ({ page }) => {
  const { root, stable } = await reopen(page)
  const failed = root.getByRole("alert").filter({ hasText: "The browser couldn't open" })
  const loading = root.getByRole("status", { name: "Loading", exact: true })
  await expect(root.getByText("Registrations: 3", { exact: true })).toBeVisible()

  // Main closes the binding: the session's server has no browser.
  await send(root, { type: "state", state: null, error: "browser.pane.unsupported" })
  await expect(failed).toBeVisible()
  await expect(loading).toHaveCount(0)
  await stable()

  // Trying again registers once more and waits for it; the tabs stay where they are, and the browser opens.
  await failed.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(root.getByText("Registrations: 4", { exact: true })).toBeVisible()
  await expect(loading).toBeVisible()
  await stable()
  await send(root, inventory(restoredPreview, restoredDocs))
  await expect(root.getByRole("combobox", { name: "Browser address", exact: true })).toHaveValue("http://localhost:4173/")
  await stable()
})

// An agent's tabs.open or tabs.focus shows its tab: it comes to the front over the file the person had selected.
story("an agent show request selects its tab over the selected file, and a plugin open wakes the suspended binding", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  const file = root.getByRole("tab", { name: "beta.ts" })
  await file.click()
  await root.getByRole("button", { name: "Agent show request" }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(file).toHaveAttribute("aria-selected", "false")
  await root.getByRole("button", { name: "Suspend binding" }).click()
  await root.getByRole("button", { name: "Plugin open and close" }).click()
  await expect(root.getByText("Plugin closed: true", { exact: true })).toBeVisible()
  await expect(root.getByText("Registrations: 3", { exact: true })).toBeVisible()
})

story("an agent show request opens the closed pane and leaves the keyboard in the composer", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const composer = root.getByRole("textbox", { name: "Composer", exact: true })
  const side = root.getByTestId("side-state")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await composer.focus()
  await page.keyboard.press(mac ? "Meta+Shift+r" : "Control+Shift+r")
  await expect(side).toHaveText("closed")
  // The agent's request arrives with no input from the person, so nothing but the reveal could move the keyboard.
  await root.getByRole("button", { name: "Agent show request" }).dispatchEvent("click")
  await expect(side).toHaveText("open")
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(composer).toBeFocused()
})

story("?W right after an agent shows another page closes that browser tab, not the session", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await address.click()
  // The request arrives with no input from the person: the keyboard stays in the pane, where ?W is the pane's.
  await root.getByRole("button", { name: "Agent shows another page", exact: true }).dispatchEvent("click")
  await expect(root.getByRole("tab", { selected: true })).toHaveCount(1)
  await expect(root.getByTestId("selected")).toHaveText("browser:tab_55555555-5555-5555-5555-555555555555")
  await expect(address).toBeFocused()
  await page.keyboard.press("ControlOrMeta+w")
  await expect(root.getByTestId("browser-closes")).toHaveText('["tab_55555555-5555-5555-5555-555555555555"]')
  await expect(root.getByTestId("session-state")).toHaveText("open")
})

story("a browser tab behind a file tab says that its page waits for the person", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await root.getByRole("tab", { name: "beta.ts" }).click()
  await root.getByRole("button", { name: "Page prompt" }).click()
  await expect(root.getByRole("img", { name: "Waiting for you" })).toBeVisible()
})

story(
  "keeps the browser tabs while the pane's Ipc is away and registers them again when it returns",
  async ({ page }) => {
    const root = page.getByTestId("browser-region-fixture")
    const tabs = root.getByRole("tab")
    await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Beta", exact: true }).click()
    await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "First inventory", exact: true }).click()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])

    // The pane's main plugin reloads: every binding goes with it, and the strip keeps the tab it will restore.
    await root.getByRole("button", { name: "Pane away", exact: true }).click()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])
    await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

    // Both attachments register again at once, without a retry timer; Beta hands main the tab to restore.
    await root.getByRole("button", { name: "Pane back", exact: true }).click()
    await expect(root.getByText("Registrations: 4", { exact: true })).toBeVisible()
    await expect(root.getByText("Beta restores: 1", { exact: true })).toBeVisible()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])
  },
)

story(
  "runs no shortcut from a page prompt, even after a click on its dimmed page; the permission bar and a drawer keep theirs",
  async ({ page }) => {
    const root = page.getByTestId("browser-region-fixture")
    const reloads = root.getByTestId("browser-reloads")
    const reviews = root.getByTestId("review-toggles")
    await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Beta", exact: true }).click()
    await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "First inventory", exact: true }).click()

    await root.getByRole("button", { name: "Page prompt", exact: true }).click()
    const dialog = root.getByRole("alertdialog", { name: "beta.example says" })
    const field = dialog.getByRole("textbox", { name: "Your answer" })
    const dimmed = root.locator("[data-browser-prompt]")
    await expect(field).toBeFocused()
    // Neither the pane's reload nor the session's review toggle runs from the prompt.
    await field.press("ControlOrMeta+r")
    await field.press("ControlOrMeta+Shift+r")
    // A click on the dimmed page keeps the keyboard in the prompt rather than giving it to the pane behind.
    await dimmed.click({ position: { x: 4, y: 4 } })
    await expect(field).toBeFocused()
    await page.keyboard.press("ControlOrMeta+r")
    await expect(reloads).toHaveText("0")
    await expect(reviews).toHaveText("0")

    // F6, Shift+F6 and the address shortcut leave the prompt open for the address field, as in Chrome; Tab comes back.
    const address = root.getByRole("combobox", { name: "Browser address", exact: true })

    for (const chord of ["F6", "Shift+F6", "ControlOrMeta+l"]) {
      await field.focus()
      await page.keyboard.press(chord)
      await expect(address).toBeFocused()
      await expect(dialog).toBeVisible()
    }

    await expect(async () => {
      await page.keyboard.press("Tab")
      await expect(field).toBeFocused({ timeout: 100 })
    }).toPass()

    // The prompt is modal for its tab only: on the address field the pane's shortcuts work and the prompt stays open.
    await address.click()
    await address.press("ControlOrMeta+r")
    await expect(reloads).toHaveText("1")
    await expect(dialog).toBeVisible()
    // A click on the dimmed page brings the keyboard back, where Escape is the prompt's cancel.
    await dimmed.click({ position: { x: 4, y: 4 } })
    await expect(field).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    // The permission bar is not modal: the pane's shortcuts work there, and Escape is its "not now".
    await root.getByRole("button", { name: "Permission request", exact: true }).click()
    const bar = root.locator('[data-component="browser-prompt"]')
    const never = bar.getByRole("button", { name: "Never allow", exact: true })
    await expect(never).toBeFocused()
    await never.press("ControlOrMeta+r")
    await expect(reloads).toHaveText("2")
    await never.press("Escape")
    await expect(bar).toBeHidden()

    // Another modal surface, as a mobile drawer, keeps the app's shortcuts; markup alone, as a chat message's, cannot
    // claim the keyboard.
    await page.evaluate(() => {
      const drawer = document.createElement("div")
      drawer.setAttribute("role", "dialog")
      drawer.setAttribute("aria-modal", "true")
      drawer.setAttribute("data-owns-keyboard", "")
      drawer.append(Object.assign(document.createElement("button"), { textContent: "Drawer action" }))
      document.body.append(drawer)
    })
    const action = page.getByRole("button", { name: "Drawer action", exact: true })
    await action.focus()
    await action.press("ControlOrMeta+Shift+r")
    await expect(reviews).toHaveText("1")
  },
)
