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
    })
  }, modules)
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
  const inspect = root.getByRole("button", { name: "Select an element to comment on", exact: true })
  const address = root.getByRole("combobox", { name: "Browser address", exact: true })
  await expect(inspect).toBeDisabled()
  await address.click()
  await address.press("ControlOrMeta+Shift+c")
  await expect(root.getByTestId("browser-inspects")).toHaveText("[]")

  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(inspect).toBeEnabled()

  await outside.focus()
  await outside.press("ControlOrMeta+Shift+c")
  await expect(inspect).toHaveAttribute("aria-pressed", "false")
  await expect(root.getByTestId("browser-inspects")).toHaveText("[]")

  await address.click()
  await expect(address).toBeFocused()
  await address.press("ControlOrMeta+Shift+c")
  await expect(inspect).toHaveAttribute("aria-pressed", "true")
  await expect(root.getByTestId("browser-inspects")).toHaveText(
    '[{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":true}]',
  )

  await address.press("ControlOrMeta+Shift+c")
  await expect(inspect).toHaveAttribute("aria-pressed", "false")
  await expect(root.getByTestId("browser-inspects")).toHaveText(
    '[{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":true},{"tabID":"tab_33333333-3333-3333-3333-333333333333","enabled":false}]',
  )
})

story("keeps in-page shortcuts like ⌘K in the page while forwarding ⌘⇧R and ⌘W to the pane", async ({ page }) => {
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

  // Shell shortcuts like ⌘⇧R and pane-scoped ⌘W are claimed before the page sees them.
  await editor.press(`${mod}+Shift+r`)
  await expect(root.getByTestId("review-toggles")).toHaveText("1")
  await editor.press(`${mod}+w`)
  await expect(editor).toHaveValue("handled:k")
  await expect(root.getByTestId("browser-closes")).toHaveText('["tab_33333333-3333-3333-3333-333333333333"]')
  await expect(root.getByTestId("session-state")).toHaveText("open")
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

story("keeps a restored browser tab selected and undrawn until the desktop's first inventory", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await expect(tabs).toHaveText(["alpha.ts"])

  // Beta was left on its browser tab, which the desktop has not reported yet.
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:tab_/)
  await expect(tabs).toHaveText(["beta.ts"])

  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(tabs).toHaveText(["beta.ts", "Preview"])
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
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
