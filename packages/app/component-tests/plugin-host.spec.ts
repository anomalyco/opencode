import type { Component, Owner } from "solid-js"
import type { PluginInfo } from "@opencode/client/promise"
import type { Context, Contract, DialogHandle, Dialogs, Live, SessionRef, SessionScreen } from "@opencode/plugin/gui"
import type { BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import type { Bridge, BridgeMessage, EnableState, Installed } from "@opencode/plugin/gui/host"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./plugin-host.fixture.tsx", import.meta.url))

/** What the scoped-registration case keeps from inside its plugin. */
type Scope = { owner?: Owner | null; end: () => void; ctx?: Context }

/** The context the session-routing case keeps from inside its plugin. */
type Kept = { ctx?: Context }

/** What the asking case keeps from inside its plugin: its dialogs, the end of its scope, and that scope's prompt. */
type Asked = { dialogs?: Dialogs; end?: () => void; prompt?: Promise<string | undefined> }

/** What the pre-mount case reads from inside its plugin's setup. */
type Reads = { state?: () => string; font?: () => string; prefs?: { value?: { count: number }; ready(): boolean } }

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

story("a plugin that finishes loading after the host unmounts is never set up", async ({ page }) => {
  const setups = await page.evaluate(async (fixture) => {
    const { mountPluginHost } = await import(fixture)
    const host = mountPluginHost()
    const state = { setups: 0 }
    host.unmount()
    host.load(() => void state.setups++)
    await new Promise((resolve) => setTimeout(resolve, 100))

    return state.setups
  }, fixture)

  expect(setups).toBe(0)
})

story("async work from synchronous setup cannot register after the host unmounts", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPluginHost, onCleanup } = await import(fixture)
    const host = mountPluginHost()
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const done = Promise.withResolvers<void>()
    const cleaned: string[] = []
    const registry = { kind: "registry" as const, id: "fixture-registry" }
    const resumed = { aborted: false }
    host.load((ctx: Context) => {
      ctx.add(registry, "before")
      onCleanup(() => void cleaned.push("owner"))
      started.resolve()
      void resume.promise.then(() => {
        // A promise callback has no owner; the signal says the work outlived the instance.
        resumed.aborted = ctx.signal.aborted
        ctx.add(registry, "after")
        done.resolve()
      })
    })
    await started.promise
    const before = host.entries(registry.id)
    host.unmount()
    resume.resolve()
    await done.promise

    return { before, after: host.entries(registry.id), cleaned, aborted: resumed.aborted }
  }, fixture)

  expect(result).toEqual({ before: 1, after: 0, cleaned: ["owner"], aborted: true })
})

story("older loads neither set up nor fail over the replacement after reloads", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPluginHost } = await import(fixture)
    const host = mountPluginHost()
    const setups: string[] = []
    host.reload()
    host.reload()
    host.load(() => void setups.push("first"), 0)
    host.fail(1, new Error("second"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    host.load(() => void setups.push("third"), 2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const outcome = { setups, status: host.status() }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ setups: ["third"], status: "active" })
})

story("a dialog service kept from before a reload opens and closes nothing under the replacement", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPluginHost } = await import(fixture)
    const host = mountPluginHost()
    const dialogs: Dialogs[] = []
    const setup = (ctx: Context) => void dialogs.push(ctx.dialogs)
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })
    const shown = (value: string) => !!document.body.textContent?.includes(value)
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(setup, 0)
    await wait(20)
    host.reload()
    host.load(setup, 1)
    await wait(20)
    const [stale, fresh] = dialogs
    const kept = stale.open(text("stale dialog"))
    fresh.open(text("fresh dialog"))
    await wait(50)
    kept.close()
    await wait(300)
    const outcome = { stale: shown("stale dialog"), fresh: shown("fresh dialog") }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ stale: false, fresh: true })
})

story("a dialog handle closes its own dialog, and a dialog closes with the scope that opened it", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPluginHost, createKeyed, createSignal } = await import(fixture)
    const host = mountPluginHost()
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })

    const shown = () =>
      ["below", "middle", "scoped", "cancelled", "brief"].filter((value) => document.body.textContent?.includes(value))

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const scope = { end: () => {} }
    const handles: DialogHandle[] = []
    host.load((ctx: Context) => {
      const [on, set] = createSignal(true)
      scope.end = () => set(false)
      handles.push(ctx.dialogs.open(text("below")), ctx.dialogs.open(text("middle")))
      createKeyed(on, () => void ctx.dialogs.open(text("scoped")))
      // Ended in the tick they open, before the deferred opening: neither shows, and the replacing one replaces nothing.
      ctx.dialogs.open(text("cancelled"), { replace: true }).close()
      const [brief, end] = createSignal(true)
      createKeyed(brief, () => void ctx.dialogs.open(text("brief")))
      end(false)
    }, 0)
    await wait(100)
    const opened = shown()
    // The middle dialog is not on top: its handle closes it and nothing else.
    handles[1]?.close()
    await wait(300)
    const closed = shown()
    scope.end()
    await wait(300)
    const ended = shown()
    host.unmount()

    return { opened, closed, ended }
  }, fixture)

  expect(result).toEqual({
    opened: ["below", "middle", "scoped"],
    closed: ["below", "scoped"],
    ended: ["below"],
  })
})

story("a dialog pushed in the same tick as a reload never mounts", async ({ page }) => {
  const shown = await page.evaluate(async (fixture) => {
    const { mountPluginHost } = await import(fixture)
    const host = mountPluginHost()
    const dialogs: Dialogs[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load((ctx: Context) => void dialogs.push(ctx.dialogs), 0)
    await wait(20)
    dialogs[0].open(() => Object.assign(document.createElement("p"), { textContent: "same tick dialog" }))
    host.reload()
    await wait(300)
    const outcome = !!document.body.textContent?.includes("same tick dialog")
    host.unmount()

    return outcome
  }, fixture)

  expect(shown).toBe(false)
})

story(
  "confirm, alert, prompt and select answer once: with the user's pick, else when their dialog or plugin goes away",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountPluginHost, createKeyed, createSignal, until } = await import(fixture)
      const host = mountPluginHost()
      const kept: Asked = {}
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

      const button = (label: string) =>
        Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === label)

      host.load((ctx: Context) => {
        const [on, set] = createSignal(true)
        kept.dialogs = ctx.dialogs
        kept.end = () => set(false)
        createKeyed(on, () => void (kept.prompt = ctx.dialogs.prompt({ title: "Scoped prompt" })))
      }, 0)
      await until(() => !!document.body.textContent?.includes("Scoped prompt"))
      // The scope that asked ends: its prompt closes and answers undefined.
      kept.end?.()
      const scoped = await kept.prompt
      const dialogs = kept.dialogs

      if (!dialogs) throw new Error("The fixture plugin never set up")

      const confirmed = dialogs.confirm({ title: "End the meetup?", confirm: "End", danger: true })
      await until(() => !!button("End"))
      button("End")?.click()

      const alerted = dialogs.alert({ title: "Meetup ended", ok: "Got it" })
      await until(() => !!button("Got it"))
      button("Got it")?.click()

      const picked = dialogs.select({
        title: "Links",
        options: [
          { title: "Alpha", value: "a" },
          { title: "Beta", value: "b", description: "second" },
        ],
      })

      const beta = () =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((element) =>
          element.textContent?.includes("Beta"),
        )

      await until(() => !!beta())
      beta()?.click()

      const dismissed = dialogs.confirm({ title: "Dismiss me" })
      await until(() => !!button("Cancel"))
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      const outcome = {
        scoped,
        confirmed: await confirmed,
        alerted: await alerted,
        picked: await picked,
        dismissed: await dismissed,
      }

      await wait(300)
      host.unmount()

      // Asked of a plugin that went away: nothing opens, and the fallback answers at once.
      return { ...outcome, late: await dialogs.prompt({ title: "Late" }) }
    }, fixture)

    expect(result).toEqual({
      scoped: undefined,
      confirmed: true,
      alerted: undefined,
      picked: "b",
      dismissed: false,
      late: undefined,
    })
  },
)

story("a plugin's toasts close when it goes away, and a handle closes only its own toast", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountHostApis, until } = await import(fixture)
    const shown = (title: string) => !!document.body.textContent?.includes(title)
    const handles: { dismiss: () => void }[] = []
    const setups = { count: 0 }

    const host = mountHostApis({
      definitions: [
        {
          id: "fixture",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              // Only the first instance shows toasts, so the reload's instance shows none of its own.
              if (setups.count++ > 0) return
              ctx.toast.show({ title: "kept toast", persistent: true })
              handles.push(ctx.toast.show({ title: "dismissed toast", persistent: true }))
            },
          }),
        },
      ],
    })

    await until(() => shown("kept toast") && shown("dismissed toast"))
    handles[0]?.dismiss()
    await until(() => !shown("dismissed toast"))
    const kept = shown("kept toast")
    host.reload("fixture")
    await until(() => setups.count === 2 && !shown("kept toast"))
    host.unmount()

    return { kept, setups: setups.count }
  }, fixture)

  expect(result).toEqual({ kept: true, setups: 2 })
})

story("ctx.ui renders the app's own components in a plugin's contribution and dialog", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountSessionRegion, until, createComponent, createSignal, Slot } = await import(fixture)

    // What the components' handlers received, for the test to read.
    const record = (value: string) => {
      document.body.dataset.ui = `${document.body.dataset.ui ?? ""}${value};`
    }

    const host = mountSessionRegion({
      active: "none:main",
      definitions: [
        {
          id: "fixture",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              const ui = ctx.ui
              const [on, setOn] = createSignal(false)
              const [name, setName] = createSignal("")

              const dialog = () =>
                ctx.dialogs.open((handle) =>
                  createComponent(ui.Dialog, {
                    title: "Fixture dialog",
                    children: "Fixture body",
                    get footer() {
                      return createComponent(ui.Button, { onClick: handle.close, children: "Close fixture" })
                    },
                  }),
                )

              ctx.add(Slot, {
                at: "session.panel.end",
                render: () => [
                  createComponent(ui.Icon, { name: "branch" }),
                  createComponent(ui.Button, { icon: "check", onClick: () => record("button"), children: "Apply" }),
                  createComponent(ui.Button, { onClick: dialog, children: "Open dialog" }),
                  createComponent(ui.Tooltip, {
                    value: "Reload tip",
                    keys: ["R"],
                    get children() {
                      return createComponent(ui.IconButton, { icon: "outline-rotate-clockwise", label: "Reload" })
                    },
                  }),
                  createComponent(ui.Menu, {
                    label: "Options",
                    items: [
                      { type: "group", label: "Fixture group", items: [{ label: "Rename", onSelect() {} }] },
                      { type: "separator" },
                      { label: "Delete", icon: "trash", keys: ["Del"], onSelect: () => record("menu") },
                    ],
                  }),
                  createComponent(ui.Loader, { size: "large" }),
                  createComponent(ui.Switch, {
                    label: "Wrap",
                    get checked() {
                      return on()
                    },
                    onChange: setOn,
                  }),
                  createComponent(ui.TextInput, {
                    label: "Name",
                    get value() {
                      return name()
                    },
                    onInput: setName,
                    onSubmit: (value: string) => record(`submit ${value}`),
                  }),
                  createComponent(ui.Keybind, { keys: ["Ctrl", "K"] }),
                  createComponent(ui.Markdown, { text: "# Fixture heading\n\nSome *text*." }),
                  createComponent(ui.Code, { content: "const fence = `\n```\n`", language: "ts" }),
                ],
              })
            },
          }),
        },
      ],
    })

    host.container.dataset.testid = "ui-host"
    await until(() => host.status("fixture") === "active")
  }, fixture)

  const root = page.getByTestId("ui-host")
  await expect(root.locator('svg[data-slot="icon-svg"] > use[href="#opencode-v2-icon-branch"]')).toHaveCount(1)
  await expect(root.locator('svg[data-component="loader-v2"]')).toHaveAttribute("width", "20")
  await expect(root.locator('[data-component="keybind-v2"]')).toHaveText("CtrlK")
  await expect(root.locator('[data-component="markdown"] h1')).toHaveText("Fixture heading")
  // A line of backticks in the code does not end its block.
  const code = root.locator('[data-component="markdown"] code.language-ts')
  await expect(code).toHaveText("const fence = `\n```\n`")
  await expect(code.locator("span[style]").first()).toBeVisible()

  const apply = root.getByRole("button", { name: "Apply" })
  await expect(apply).toHaveAttribute("data-component", "button-v2")
  await expect(apply.locator('use[href="#opencode-v2-icon-check"]')).toHaveCount(1)
  await apply.click()

  const reload = root.getByRole("button", { name: "Reload" })
  await expect(reload).toHaveAttribute("data-component", "icon-button-v2")
  await reload.hover()
  await expect(page.locator('[data-component="tooltip-v2"]')).toHaveText("Reload tipR")

  await root.getByRole("button", { name: "Options" }).click()
  const menu = page.getByRole("menu")
  await expect(menu.getByText("Fixture group")).toBeVisible()
  await expect(menu.getByRole("separator")).toHaveCount(1)
  await menu.getByRole("menuitem", { name: "Delete" }).click()

  // The switch's input is visually hidden under its label, which takes the click.
  await root.getByText("Wrap", { exact: true }).click()
  await expect(root.getByRole("switch", { name: "Wrap" })).toBeChecked()

  const field = root.getByRole("textbox", { name: "Name" })
  await field.fill("acme")
  await field.press("Enter")
  await expect(page.locator("body")).toHaveAttribute("data-ui", "button;menu;submit acme;")

  await root.getByRole("button", { name: "Open dialog" }).click()
  const dialog = page.getByRole("dialog", { name: "Fixture dialog" })
  await expect(dialog).toContainText("Fixture body")
  await expect(dialog.locator('[data-slot="dialog-close-button"]')).toHaveCount(1)
  await dialog.getByRole("button", { name: "Close fixture" }).click()
  await expect(dialog).toHaveCount(0)
})

story(
  "routing A, B, then A again: a kept session stays A, the same screen follows the route, and no render remounts",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountSessionRegion, until, Panel, Slot } = await import(fixture)
      const mounts = { single: 0, grouped: 0, slot: 0 }

      const inputs: Partial<
        Record<keyof typeof mounts, { readonly session: { readonly id: string }; readonly screen: SessionScreen }>
      > = {}

      const kept: Kept = {}
      const node = () => document.createElement("p")

      // One render of each kind the host has: a selected tab, a group that stays mounted, and a slot.
      const render =
        (kind: keyof typeof mounts) =>
        (input: { readonly session: { readonly id: string }; readonly screen: SessionScreen }) => {
          mounts[kind]++
          inputs[kind] = input

          return node()
        }

      const host = mountSessionRegion({
        active: "single:main",
        definitions: [
          {
            id: "single",
            windowEntry: async () => ({
              default: (ctx: Context) => {
                const tab = { id: "main", title: "Single" }
                kept.ctx = ctx
                ctx.add(Panel, { id: "main", region: "side", list: () => [tab], render: render("single") })
                ctx.add(Slot, { at: "session.panel.end", render: render("slot") })
              },
            }),
          },
          {
            id: "grouped",
            windowEntry: async () => ({
              default: (ctx: Context) => {
                const tab = { id: "main", title: "Grouped", group: "group" }
                ctx.add(Panel, { id: "main", region: "side", list: () => [tab], render: render("grouped") })
              },
            }),
          },
        ],
      })

      await until(() => mounts.single > 0 && mounts.grouped > 0 && mounts.slot > 0)

      // Session A's object, as a plugin keeps it, and the screen while it routes A.
      const session = kept.ctx?.sessions.current()
      const screen = kept.ctx?.screen.current()

      const seen = () => ({
        mounts: { ...mounts },
        sessions: [inputs.single?.session.id, inputs.grouped?.session.id, inputs.slot?.session.id],
        screens: [inputs.single?.screen === screen, inputs.grouped?.screen === screen, inputs.slot?.screen === screen],
        kept: session?.id,
        fresh: kept.ctx?.sessions.current() !== session,
        screen: {
          same: kept.ctx?.screen.current() === screen,
          aligned: !!kept.ctx?.screen.current() === !!kept.ctx?.sessions.current(),
        },
      })

      const steps = [seen()]
      host.route("b")
      steps.push(seen())
      // An action through the screen targets the session routed now.
      screen?.composer.attach({ type: "file", path: "notes.md" })
      host.route("a")
      steps.push(seen())
      host.leave()
      const home = seen()
      host.unmount()

      return { steps, home, attached: host.attached }
    }, fixture)

    const step = (id: string, fresh: boolean) => ({
      mounts: { single: 1, grouped: 1, slot: 1 },
      sessions: [id, id, id],
      screens: [true, true, true],
      kept: "a",
      fresh,
      screen: { same: true, aligned: true },
    })

    // Routing A again makes a new object for the new visit; the kept one still names A.
    expect(result).toEqual({
      steps: [step("a", false), step("b", true), step("a", true)],
      home: { ...step("a", true), screen: { same: false, aligned: true } },
      attached: ["b"],
    })
  },
)

story(
  "before the app interface mounts, host APIs read their defaults and keep writes and dialogs until it mounts",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountHostApis, until, createMemo, Schema } = await import(fixture)
      const Prefs = Schema.Struct({ count: Schema.Number })
      const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })
      const shown = () => ["kept", "cancelled"].filter((value) => document.body.textContent?.includes(value))
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const fake = { key: "local\nses_fixture", id: "ses_fixture", tab: "tab", pending: false, location: undefined }
      // SAFETY: the stand-in interface reads only the key it is given; the host APIs pass the session through.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
      const session = fake as unknown as SessionRef

      const reads: Reads = {}

      const host = mountHostApis({
        definitions: [
          {
            id: "fixture",
            windowEntry: async () => ({
              default: (ctx: Context) => {
                // Setup runs before the interface mounts, as every built-in's does.
                ctx.layout.open("fixture:main", session)
                ctx.layout.settings("fixture")
                // A dialog waits for the interface too; one its handle closes meanwhile never shows.
                ctx.dialogs.open(text("kept"))
                ctx.dialogs.open(text("cancelled")).close()

                const prefs = ctx.storage.store("prefs", {
                  schema: Prefs,
                  initial: { count: 0 },
                  scope: { server: "local" },
                })

                prefs.update((draft) => {
                  draft.count++
                })
                reads.state = createMemo(() => ctx.layout.state("fixture:main", session))
                reads.font = createMemo(() => ctx.appearance.font("mono"))
                reads.prefs = prefs
              },
            }),
          },
        ],
      })

      const read = () => ({
        state: reads.state?.(),
        font: reads.font?.().startsWith('"JetBrainsMono Nerd Font Mono"') ? "default mono" : reads.font?.(),
        prefs: reads.prefs?.value?.count,
        ready: reads.prefs?.ready(),
        writes: [...host.writes],
        dialogs: shown(),
      })

      await until(() => host.status("fixture") === "active")
      // Long enough for a dialog's deferred opening to have shown it.
      await wait(300)
      const before = read()
      host.attach()
      await until(() => host.writes.length === 2 && shown().length > 0)
      const after = read()
      host.unmount()

      return { before, after }
    }, fixture)

    expect(result).toEqual({
      before: { state: "closed", font: "default mono", prefs: undefined, ready: false, writes: [], dialogs: [] },
      after: {
        state: "visible",
        font: "fixture mono",
        prefs: 1,
        ready: true,
        writes: ["open fixture:main", "settings fixture"],
        dialogs: ["kept"],
      },
    })
  },
)

// Selection follows opt-in tier order, not the strip's pinned-first order. Unrelated regular tabs never opt in.
const tiers: readonly { name: string; tabs: readonly BuiltinPanelTab[]; active?: string; expected: string }[] = [
  {
    name: "regular tabs, in stored order",
    tabs: [
      { id: "details", title: "Details" },
      { id: "review", title: "Review", pinned: true, fallback: true },
      { id: "context", title: "Context", first: true, fallback: true },
      { id: "file-one", title: "File one", fallback: true },
      { id: "file-two", title: "File two", fallback: true },
    ],
    expected: "file-one",
  },
  {
    name: "first tabs before pinned tabs",
    tabs: [
      { id: "details", title: "Details" },
      { id: "review", title: "Review", pinned: true, fallback: true },
      { id: "context", title: "Context", first: true, fallback: true },
    ],
    expected: "context",
  },
  {
    name: "pinned tabs when no other tier opts in",
    tabs: [
      { id: "details", title: "Details" },
      { id: "review", title: "Review", pinned: true, fallback: true },
    ],
    expected: "review",
  },
  {
    name: "no implicit fallback",
    tabs: [{ id: "details", title: "Details", fallback: false }],
    expected: "",
  },
  {
    name: "a stored selection wins without opting in",
    tabs: [
      { id: "details", title: "Details" },
      { id: "file", title: "File", fallback: true },
    ],
    active: "details:main",
    expected: "details",
  },
]

tiers.forEach((row) => {
  story(`panel fallback: ${row.name}`, async ({ page }) => {
    const selected = await page.evaluate(
      async (input) => {
        const { mountSessionRegion, Panel, until } = await import(input.fixture)

        const host = mountSessionRegion({
          active: input.row.active ?? "gone:main",
          definitions: input.row.tabs.map((tab) => ({
            id: tab.id,
            windowEntry: async () => ({
              default: (ctx: Context) => {
                const item = { ...tab, id: "main" }
                ctx.add(Panel, { id: "main", region: "side", list: () => [item], render: () => ctx.id })
              },
            }),
          })),
        })

        await until(() => input.row.tabs.every((tab) => host.status(tab.id) === "active"))
        const result = host.container.textContent
        host.unmount()

        return result
      },
      { fixture, row },
    )

    expect(selected).toBe(row.expected)
  })
})

story("a plugin reloaded while disabled starts when it is enabled again", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPluginHost } = await import(fixture)
    const host = mountPluginHost()
    const setups: string[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(() => void setups.push("first"), 0)
    await wait(20)
    host.disable()
    await wait(20)
    host.reload()
    const afterReload = host.status()

    // A load the reload started finishes while the plugin is still disabled.
    if (host.count() > 1) host.load(() => void setups.push("while disabled"), 1)
    await wait(20)
    host.enable()
    await wait(20)
    host.load(() => void setups.push("enabled"), host.count() - 1)
    await wait(50)
    const outcome = { afterReload, setups, status: host.status() }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ afterReload: "disabled", setups: ["first", "enabled"], status: "active" })
})

story(
  "a registration is withdrawn with the scope that made it, and at once when that scope already ended",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountPlugins, until, createKeyed, createSignal, getOwner, runWithOwner } = await import(fixture)
      const registry = { kind: "registry" as const, id: "fixture-scoped" }
      const scope: Scope = { end: () => {} }

      const host = mountPlugins({
        definitions: [
          {
            id: "fixture",
            windowEntry: async () => ({
              default: (ctx: Context) => {
                const [on, set] = createSignal(true)
                scope.end = () => set(false)
                scope.ctx = ctx
                createKeyed(on, () => {
                  scope.owner = getOwner()
                  ctx.add(registry, "during")
                })
              },
            }),
          },
        ],
      })

      await until(() => host.status("fixture") === "active")
      const during = host.entries(registry.id)
      scope.end()
      const ended = host.entries(registry.id)
      // A captured owner of a generation that ended, as async work resuming late would hold.
      runWithOwner(scope.owner, () => scope.ctx?.add(registry, "late"))
      const late = host.entries(registry.id)
      host.unmount()

      return { during, ended, late }
    }, fixture)

    expect(result).toEqual({ during: 1, ended: 0, late: 0 })
  },
)

story("a contribution that throws renders nothing and records the error; the others stay", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPlugins, until, Slot } = await import(fixture)
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })

    const host = mountPlugins({
      definitions: [
        {
          id: "fixture",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              ctx.add(Slot, {
                at: "window.bottom",
                render: () => {
                  throw new Error("broken contribution")
                },
              })
              ctx.add(Slot, { at: "window.bottom", render: text("kept") })
            },
          }),
        },
        {
          id: "other",
          windowEntry: async () => ({
            default: (ctx: Context) => void ctx.add(Slot, { at: "window.bottom", render: text("other") }),
          }),
        },
      ],
    })

    await until(() => !!host.failure("fixture") && !!host.container.textContent?.includes("other"))
    const failure = host.failure("fixture")

    const outcome = {
      text: host.container.textContent,
      status: [host.status("fixture"), host.status("other")],
      failure: { phase: failure?.phase, named: !!failure?.error.includes("broken contribution") },
    }

    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({
    text: "keptother",
    status: ["active", "active"],
    failure: { phase: "render", named: true },
  })
})

story(
  "plugin GUIs join, hot-reload in place, run their returned cleanup and leave, without holding startup",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountPlugins, until } = await import(fixture)
      const builtinLoad = Promise.withResolvers<void>()
      const log: string[] = []

      // Each setup returns its cleanup, as a server or TUI plugin's setup does.
      const entry = (name: string) => async () => ({
        default: () => {
          log.push(`setup ${name}`)

          return () => void log.push(`cleanup ${name}`)
        },
      })

      const builtin = {
        id: "builtin",
        windowEntry: async () => {
          await builtinLoad.promise

          return entry("builtin")()
        },
      }

      const host = mountPlugins({ definitions: [builtin] })
      // A plugin that joins before the built-ins settle, and never loads, must not hold the app's first render.
      host.define([builtin, { id: "stuck", windowEntry: () => new Promise<never>(() => {}) }])
      builtinLoad.resolve()
      await until(() => host.ready())
      const startup = { ready: host.ready(), stuck: host.status("stuck") }

      host.define([builtin, { id: "acme", windowEntry: entry("acme 1") }])
      await until(() => host.status("acme") === "active")
      // A new revision of the plugin's bundle is a new definition under the same id.
      host.define([builtin, { id: "acme", windowEntry: entry("acme 2") }])
      await until(() => log.includes("setup acme 2"))
      const reloaded = [...log]

      host.define([builtin])
      await until(() => log.includes("cleanup acme 2"))
      const outcome = { startup, reloaded, log: [...log], gone: host.status("acme") ?? "none" }

      host.unmount()

      return outcome
    }, fixture)

    expect(result).toEqual({
      startup: { ready: true, stuck: "loading" },
      reloaded: ["setup builtin", "setup acme 1", "cleanup acme 1", "setup acme 2"],
      log: ["setup builtin", "setup acme 1", "cleanup acme 1", "setup acme 2", "cleanup acme 2"],
      gone: "none",
    })
  },
)

story(
  "a plugin follows another's contract across load, reload and disable, provides only its own, and a failed one stays failed",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountPlugins, until, Contract } = await import(fixture)
      const Tree: Contract<{ version: number }, "provider.tree"> = Contract.define("provider.tree")
      const providerLoad = Promise.withResolvers<void>()
      const versions = { value: 0 }
      const thiefLoads = { value: 0 }
      const observed = { read: (): Live<{ version: number }> => ({ status: "pending" }) }

      const host = mountPlugins({
        definitions: [
          {
            id: "consumer",
            windowEntry: async () => ({ default: (ctx: Context) => void (observed.read = ctx.use(Tree)) }),
          },
          {
            id: "provider",
            windowEntry: async () => {
              await providerLoad.promise

              return { default: (ctx: Context) => void ctx.provide(Tree, { version: ++versions.value }) }
            },
          },
          // Another plugin cannot provide the provider's contract: its setup fails, and the contract stays the provider's.
          {
            id: "thief",
            windowEntry: async () => {
              thiefLoads.value++

              return { default: (ctx: Context) => void ctx.provide(Tree, { version: 0 }) }
            },
          },
        ],
      })

      await until(() => host.status("consumer") === "active" && host.status("thief") === "failed")
      const loading = observed.read().status
      providerLoad.resolve()
      await until(() => observed.read().status === "active")
      const first = observed.read()
      host.reload("provider")
      await until(() => {
        const live = observed.read()

        return live.status === "active" && live.generation === 2
      })
      const second = observed.read()
      host.disable(["provider"])
      await until(() => observed.read().status === "inactive")

      const outcome = {
        loading,
        first,
        second,
        disabled: observed.read(),
        thief: host.failure("thief")?.error.includes('provides only its own contracts, not "provider.tree"'),
        // Disabling another plugin does not retry the failed one; only Reload or a new revision does.
        thiefLoads: thiefLoads.value,
      }

      host.unmount()

      return outcome
    }, fixture)

    expect(result).toEqual({
      loading: "pending",
      first: { status: "active", value: { version: 1 }, generation: 1 },
      second: { status: "active", value: { version: 2 }, generation: 2 },
      disabled: { status: "inactive", reason: "disabled" },
      thief: true,
      thiefLoads: 1,
    })
  },
)

story(
  "a plugin's own main client waits for main, follows its state, and rejects once main cannot answer",
  async ({ page }) => {
    const result = await page.evaluate(async (fixture) => {
      const { mountPlugins, until, Ipc, Schema, createSignal } = await import(fixture)
      const Awake = Ipc.define({ id: "acme.awake", methods: { get: { output: Schema.Boolean } } })
      const Other = Ipc.define({ id: "other.ipc", methods: {} })
      const [available, setAvailable] = createSignal(false)
      const [awake, setAwake] = createSignal(false)
      const kept: Kept = {}

      const client = {
        get: async () => awake(),
        state: () => ({ awake: awake() }),
        on: () => () => {},
      }

      const host = mountPlugins({
        ipc: (token: { readonly id: string }) => (token.id === Awake.id && available() ? client : undefined),
        definitions: [{ id: "acme", windowEntry: async () => ({ default: (ctx: Context) => void (kept.ctx = ctx) }) }],
      })

      await until(() => !!kept.ctx)
      const ctx = kept.ctx

      if (!ctx) throw new Error("the plugin never set up")

      const main = ctx.main(Awake)
      const waiting = main.get()
      const before = main.state()
      setAwake(true)
      setAvailable(true)
      const answered = await waiting
      const state = main.state()

      const foreign = (() => {
        try {
          ctx.main(Other)

          return false
        } catch (cause) {
          return String(cause).includes('calls only its own main entry, not Ipc "other.ipc"')
        }
      })()

      host.disable(["acme"])

      const rejected = await main.get().then(
        () => false,
        (cause: unknown) => String(cause).includes("unavailable"),
      )

      host.unmount()

      return { before, answered, state, foreign, rejected, same: ctx.main(Awake) === main }
    }, fixture)

    expect(result).toEqual({
      before: undefined,
      answered: true,
      state: { awake: true },
      foreign: true,
      rejected: true,
      same: true,
    })
  },
)

story("a contract component reads its provider context and preserves reactive props", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { bindPlugin, createComponent, createSignal, Contract, mountPlugins, Slot, until, usePlugin } = await import(
      fixture
    )

    const View: Contract<{ View: Component<{ readonly label: string }> }, "provider.view"> =
      Contract.define("provider.view")

    const observed = { context: "", read: () => "", change: () => {}, mounts: 0 }

    const host = mountPlugins({
      definitions: [
        {
          id: "provider",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              ctx.provide(View, {
                View: bindPlugin((props: { readonly label: string }) => {
                  observed.context = usePlugin().id
                  observed.read = () => props.label
                  observed.mounts++

                  return document.createTextNode(observed.context)
                }),
              })
            },
          }),
        },
        {
          id: "consumer",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              const view = ctx.use(View)
              const [label, setLabel] = createSignal("before")
              observed.change = () => setLabel("after")
              ctx.add(Slot, () => {
                const live = view()

                if (live.status !== "active") return undefined

                return {
                  at: "window.bottom",
                  render: () =>
                    createComponent(live.value.View, {
                      get label() {
                        return label()
                      },
                    }),
                }
              })
            },
          }),
        },
      ],
    })

    await until(() => host.container.textContent === "provider")
    const before = observed.read()
    observed.change()
    const outcome = { context: observed.context, mounts: observed.mounts, before, after: observed.read() }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ context: "provider", mounts: 1, before: "before", after: "after" })
})

story("Extensions › Plugins merges the own server's plugins with the desktop GUIs they run", async ({ page }, info) => {
  const calls = await page.evaluateHandle(async (fixture) => {
    const { mountPlugins, until } = await import(fixture)
    const calls: string[] = []

    const installed: Installed[] = [
      // A built-in that runs stays hidden; one that failed keeps a row, as nothing else reports it.
      { id: "review", builtin: true, enabled: true },
      { id: "terminal", builtin: true, enabled: true },
      { id: "acme", builtin: false, enabled: true, server: true, tui: true },
      // A package with only a GUI part has no other part to tag, and here the server list does not name it.
      { id: "notes", builtin: false, enabled: false, server: false, tui: false },
      // A plugin whose `os` leaves out this system keeps a row that says so, and never loads.
      { id: "windows-only", builtin: false, enabled: true, server: true, unsupported: true },
      // A bundle main could not read never reaches the window.
      { id: "garbled", builtin: false, enabled: true, error: "SyntaxError: garbled bundle" },
      { id: "flaky", builtin: false, enabled: true },
    ]

    const listed = (id: string, features: PluginInfo["features"]): PluginInfo => ({
      id,
      source: { type: "package", target: id },
      features,
      state: { status: "active" },
    })

    const bridge: Bridge = {
      packaged: false,
      call: async () => undefined,
      subscribe: async () => ({ available: false }),
      on: () => () => {},
      embed() {},
      capture: async () => undefined,
      runMenubarItem() {},
      configure() {},
      pluginGuis: async () => ({ plugins: [], reserved: [] }),
      manager: {
        initial: Promise.resolve(installed),
        list: async () => installed,
        enable: async (id) => void calls.push(`enable ${id}`),
        disable: async (id) => void calls.push(`disable ${id}`),
        reload: async (id) => void calls.push(`reload ${id}`),
      },
    }

    const fails = (message: string) => async () => ({
      default: () => {
        throw new Error(message)
      },
    })

    const host = mountPlugins({
      bridge,
      plugins: [
        listed("acme", { gui: true, server: true, tui: true }),
        listed("windows-only", { gui: true, server: true }),
        listed("flaky", { gui: true }),
        // A plugin without a GUI lists its name only.
        listed("lint-rules", { server: true }),
        // The server's own built-ins are not listed, as on every server.
        { ...listed("opencode-builtin", { server: true }), source: { type: "builtin" } },
      ],
      definitions: [
        { id: "review", windowEntry: async () => ({ default: () => {} }) },
        { id: "terminal", windowEntry: fails("terminal broke") },
        { id: "acme", windowEntry: async () => ({ default: () => {} }) },
        { id: "notes", windowEntry: async () => ({ default: () => {} }) },
        { id: "flaky", windowEntry: fails("flaky broke") },
      ],
    })

    await until(() => !!host.container.textContent?.includes("cli.json") && host.status("flaky") === "failed")

    return calls
  }, fixture)

  const plugins = page.getByTestId("extension-plugins")
  await plugins.screenshot({ path: info.outputPath("extension-plugins.png") })
  // One row per plugin id, in the server's order, then what only main reports, then failed built-ins.
  await expect(plugins.locator(".settings-extension-name")).toHaveText([
    "acme",
    "windows-only",
    "flaky",
    "lint-rules",
    "notes",
    "garbled",
    "terminal",
  ])
  // Only plugins from the config tag their other parts, and one note says how to turn those off.
  await expect(plugins.getByText("Server", { exact: true })).toHaveCount(1)
  await expect(plugins.getByText("TUI", { exact: true })).toHaveCount(1)
  await expect(plugins.getByText(/Switches turn off only a plugin's desktop UI/)).toHaveCount(1)
  await expect(plugins.getByText("Not available on this system.", { exact: true })).toBeVisible()
  // An error shows its first line; the rest, such as a stack trace, is behind a toggle that a one-line error lacks.
  await expect(plugins.getByText("SyntaxError: garbled bundle", { exact: true })).toBeVisible()
  await expect(plugins.getByText("Error: flaky broke", { exact: true })).toBeVisible()
  await expect(plugins.getByText("Error: terminal broke", { exact: true })).toBeVisible()
  await expect(plugins.getByRole("button", { name: "Show details" })).toHaveCount(2)
  const flaky = plugins.locator(".settings-extension-row").filter({ hasText: "flaky" })
  await flaky.getByRole("button", { name: "Show details" }).press("Enter")
  await expect(flaky.locator("pre")).toHaveText(/^Error: flaky broke\s+at /)
  await expect(flaky.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true")
  await expect(plugins.getByText("Failed", { exact: true })).toHaveCount(2)
  await expect(plugins.getByText("Built-in", { exact: true })).toHaveCount(1)
  // A built-in always runs, so it has no switch; the switches carry on and off without a status label.
  await expect(plugins.getByRole("switch")).toHaveCount(3)
  await expect(plugins.getByRole("switch", { name: "terminal" })).toHaveCount(0)
  await expect(plugins.getByRole("button", { name: "Reload" })).toHaveCount(4)
  await expect(plugins.getByText("Active", { exact: true })).toHaveCount(0)

  // The fixture mounts below the story, out of the viewport, so the controls are driven from the keyboard.
  await plugins.getByRole("switch", { name: "acme" }).press("Space")
  await plugins.getByRole("button", { name: "Reload" }).nth(1).press("Enter")
  expect(await calls.jsonValue()).toEqual(["disable acme", "reload flaky"])
})

const invalidSetups = ["promise", "thenable"]

invalidSetups.forEach((kind) => {
  story(`window setup rejects a returned ${kind}`, async ({ page }) => {
    const result = await page.evaluate(
      async (input) => {
        const { mountPlugins, until } = await import(input.fixture)
        const resume = Promise.withResolvers<void>()
        const done = Promise.withResolvers<void>()
        const registry = { kind: "registry" as const, id: "invalid-setup" }
        const observed = { aborted: false }

        const host = mountPlugins({
          definitions: [
            {
              id: "invalid",
              windowEntry: async () => ({
                default: (ctx: Context) => {
                  ctx.add(registry, "before")

                  if (input.kind === "thenable")
                    return {
                      then(resolve: () => void) {
                        resolve()
                      },
                    }

                  return resume.promise.then(() => {
                    observed.aborted = ctx.signal.aborted
                    ctx.add(registry, "after")
                    done.resolve()
                  })
                },
              }),
            },
          ],
        })

        await until(() => host.ready())

        const failed = {
          status: host.status("invalid"),
          error: host.failure("invalid")?.error.includes("Window setup must be synchronous"),
          entries: host.entries(registry.id),
        }

        resume.resolve()

        if (input.kind === "promise") await done.promise
        const after = { entries: host.entries(registry.id), aborted: observed.aborted }
        host.unmount()

        return { failed, after }
      },
      { fixture, kind },
    )

    expect(result).toEqual({
      failed: { status: "failed", error: true, entries: 0 },
      after: { entries: 0, aborted: kind === "promise" },
    })
  })
})

story("declared global stores load before setup, so setup reads the stored value", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountPlugins, until, Schema, Store } = await import(fixture)
    const Prefs = Schema.Struct({ open: Schema.Boolean })
    const seen: unknown[] = []

    const host = mountPlugins({
      stored: { "plugin.fixture.prefs": { open: true } },
      definitions: [
        {
          id: "fixture",
          stores: { prefs: Store.global(Prefs, { open: false }) },
          windowEntry: async () => ({
            default: (ctx: Context & { stores: { prefs: { value: { open: boolean } } } }) =>
              void seen.push(ctx.stores.prefs.value.open),
          }),
        },
      ],
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    const held = { status: host.status("fixture"), seen: [...seen] }
    host.release()
    await until(() => host.status("fixture") === "active")
    const outcome = { held, seen }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({ held: { status: "loading", seen: [] }, seen: [true] })
})

story("startup enable state does not wait for the manager, and live updates beat older replies", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { Contract, mountPlugins, until } = await import(fixture)
    const Provider: Contract<number, "disabled.value"> = Contract.define("disabled.value")
    const observed = { read: (): Live<number> => ({ status: "pending" }) }
    const initial = Promise.withResolvers<readonly EnableState[]>()
    const reply = Promise.withResolvers<readonly Installed[]>()
    const listeners = new Set<(message: BridgeMessage) => void>()
    const setups: string[] = []

    const list = (disabled: readonly string[]): Installed[] =>
      ["enabled", "disabled"].map((id) => ({ id, builtin: false, enabled: !disabled.includes(id) }))

    const bridge: Bridge = {
      packaged: false,
      call: async () => undefined,
      subscribe: async () => ({ available: false }),
      on: (listener) => {
        listeners.add(listener)

        return () => void listeners.delete(listener)
      },
      embed() {},
      capture: async () => undefined,
      runMenubarItem() {},
      configure() {},
      pluginGuis: async () => ({ plugins: [], reserved: [] }),
      manager: {
        initial: initial.promise,
        list: () => reply.promise,
        enable: async () => {},
        disable: async () => {},
        reload: async () => {},
      },
    }

    const host = mountPlugins({
      bridge,
      // The consumer comes first; the provider's setting arrives asynchronously from the preload.
      definitions: [
        {
          id: "enabled",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              setups.push("enabled")
              observed.read = ctx.use(Provider)
            },
          }),
        },
        {
          id: "disabled",
          windowEntry: async () => ({
            default: (ctx: Context) => {
              setups.push("disabled")
              ctx.provide(Provider, 1)
            },
          }),
        },
      ],
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    const before = [...setups]
    initial.resolve([{ id: "disabled", enabled: false }])
    await until(() => host.ready())

    const started = {
      setups: [...setups],
      status: host.status("disabled"),
      live: observed.read(),
    }

    const unknown: { ready: boolean; setups: string[]; status?: string }[] = []

    // A failed startup reply must not temporarily activate the disabled plugin while list() waits.
    for (const failure of ["unknown", "rejected"]) {
      const initial = failure === "unknown" ? Promise.resolve(undefined) : Promise.reject(new Error("snapshot failed"))
      const reply = Promise.withResolvers<readonly Installed[]>()

      const failed = mountPlugins({
        bridge: { ...bridge, manager: { ...bridge.manager, initial, list: () => reply.promise } },
        definitions: [
          { id: "disabled", windowEntry: async () => ({ default: () => void setups.push("wrongly enabled") }) },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      const blocked = { ready: failed.ready(), setups: [...setups] }

      reply.resolve(list(["disabled"]))
      await until(() => failed.ready())
      unknown.push({ ...blocked, status: failed.status("disabled") })
      failed.unmount()
    }

    listeners.forEach((listener) => listener({ type: "installed", list: list(["enabled"]) }))
    await until(() => host.status("disabled") === "active" && host.status("enabled") === "disabled")
    reply.resolve(list(["disabled"]))
    await new Promise((resolve) => setTimeout(resolve, 50))

    const updated = {
      setups: [...setups],
      status: [host.status("enabled"), host.status("disabled")],
    }

    host.unmount()

    return { before, started, unknown, updated, listeners: listeners.size }
  }, fixture)

  expect(result).toEqual({
    before: [],
    started: {
      setups: ["enabled"],
      status: "disabled",
      live: { status: "inactive", reason: "disabled" },
    },
    unknown: [
      { ready: false, setups: ["enabled"], status: "disabled" },
      { ready: false, setups: ["enabled"], status: "disabled" },
    ],
    updated: { setups: ["enabled", "disabled"], status: ["disabled", "active"] },
    listeners: 0,
  })
})

story("composer pills show per session, open their rows, and fail only their own plugin", async ({ page }) => {
  const statuses = await page.evaluate(async (fixture) => {
    const { mountComposerPills, until, ComposerPill } = await import(fixture)

    const host = mountComposerPills({
      definitions: [
        {
          id: "acme",
          windowEntry: async () => ({
            default: (ctx: Context) =>
              void ctx.add(ComposerPill, {
                id: "pulls",
                show: (input: { readonly session: { readonly directory: string } }) => ({
                  icon: "github",
                  label: "2 pull requests",
                  tone: "danger",
                  title: "Pull requests",
                  rows: [
                    {
                      id: "12",
                      label: "#12 Fix the tree",
                      icon: "circle-x",
                      tone: "danger",
                      detail: input.session.directory,
                      run: () => void (document.body.dataset.picked = "12"),
                    },
                    { id: "13", label: "#13 Draft", icon: "branch" },
                  ],
                }),
              }),
          }),
        },
        // A pill with nothing to show for this session renders nothing.
        {
          id: "quiet",
          windowEntry: async () => ({
            default: (ctx: Context) => void ctx.add(ComposerPill, { id: "none", show: () => undefined }),
          }),
        },
        {
          id: "broken",
          windowEntry: async () => ({
            default: (ctx: Context) =>
              void ctx.add(ComposerPill, {
                id: "boom",
                show: () => {
                  throw new Error("pill failed")
                },
              }),
          }),
        },
      ],
    })

    await until(() => !!host.failure("broken") && host.status("acme") === "active")

    return {
      acme: host.status("acme"),
      quiet: host.status("quiet"),
      broken: host.failure("broken"),
    }
  }, fixture)

  expect(statuses).toEqual({
    acme: "active",
    quiet: "active",
    broken: { phase: "render", error: expect.stringContaining("pill failed") },
  })

  const pills = page.getByTestId("composer-pills").locator('[data-slot="session-plugin-pill"]')
  await expect(pills).toHaveCount(1)
  await expect(pills).toHaveText("2 pull requests")
  await expect(pills).toHaveAttribute("aria-label", "Pull requests")
  await expect(pills.locator("svg").first()).toHaveClass(/text-v2-state-fg-danger/)

  await pills.click()
  const menu = page.locator('[data-slot="session-plugin-pill-menu"]')
  await expect(menu.getByText("Pull requests")).toBeVisible()
  const rows = menu.locator('[data-slot="session-plugin-pill-row"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText("/repo")
  // A row without `run` only shows.
  await expect(rows.nth(1)).toHaveAttribute("data-disabled", "")

  await rows.nth(0).click()
  await expect(page.locator("body")).toHaveAttribute("data-picked", "12")
})

story("a composer pill with a menu opens the plugin's content under the host's heading", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountComposerPills, until, ComposerPill } = await import(fixture)

    const host = mountComposerPills({
      definitions: [
        {
          id: "acme",
          windowEntry: async () => ({
            default: (ctx: Context) =>
              void ctx.add(ComposerPill, {
                id: "goal",
                // `menu` wins over the view's rows.
                show: () => ({ label: "Goal", title: "Ship the release", rows: [{ id: "unused", label: "Unused" }] }),
                menu: (input: { readonly session: { readonly directory: string }; close(): void }) => {
                  const button = document.createElement("button")
                  button.dataset.testid = "goal-pause"
                  button.textContent = `Pause ${input.session.directory}`
                  button.onclick = () => input.close()

                  return button
                },
              }),
          }),
        },
      ],
    })

    await until(() => host.status("acme") === "active")
  }, fixture)

  const pill = page.getByTestId("composer-pills").locator('[data-slot="session-plugin-pill"]')
  await expect(pill).toHaveText("Goal")

  await pill.click()
  const popover = page.locator('[data-slot="session-plugin-pill-popover"]')
  await expect(popover.getByText("Ship the release")).toBeVisible()
  await expect(popover.locator('[data-slot="session-plugin-pill-row"]')).toHaveCount(0)
  await expect(popover.getByTestId("goal-pause")).toHaveText("Pause /repo")

  await popover.getByTestId("goal-pause").click()
  await expect(popover).toHaveCount(0)

  // The content renders again on the next open.
  await pill.click()
  await expect(page.getByTestId("goal-pause")).toBeVisible()
})
