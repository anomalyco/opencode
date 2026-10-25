import type { Component, Owner } from "solid-js"
import type {
  Context,
  Contract,
  DialogHandle,
  Dialogs,
  Live,
  PanelTab,
  SessionRef,
  SessionScreen,
} from "@opencode/gui-extensions/sdk"
import type { Bridge, BridgeMessage, EnableState, Installed } from "@opencode/gui-extensions/sdk/bridge"
import { expect, sourceURL, story } from "../../storybook/playwright/story"

const fixture = sourceURL(new URL("./extension-host.fixture.tsx", import.meta.url))

/** What the scoped-registration case keeps from inside its extension. */
type Scope = { owner?: Owner | null; end: () => void; ctx?: Context }

/** The context the session-routing case keeps from inside its extension. */
type Kept = { ctx?: Context }

/** What the pre-mount case reads from inside its extension's setup. */
type Reads = { state?: () => string; font?: () => string; prefs?: { value?: { count: number }; ready(): boolean } }

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

story("an extension that finishes loading after the host unmounts is never set up", async ({ page }) => {
  const setups = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
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
    const { mountExtensionHost, onCleanup } = await import(fixture)
    const host = mountExtensionHost()
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
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
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
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
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
    const { mountExtensionHost, createKeyed, createSignal } = await import(fixture)
    const host = mountExtensionHost()
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
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
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
            renderer: async () => ({
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
            renderer: async () => ({
              default: (ctx: Context) => {
                const tab = { id: "main", title: "Grouped", group: "group" }
                ctx.add(Panel, { id: "main", region: "side", list: () => [tab], render: render("grouped") })
              },
            }),
          },
        ],
      })

      await until(() => mounts.single > 0 && mounts.grouped > 0 && mounts.slot > 0)

      // Session A's object, as an extension keeps it, and the screen while it routes A.
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
            renderer: async () => ({
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
const tiers: readonly { name: string; tabs: readonly PanelTab[]; active?: string; expected: string }[] = [
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
            renderer: async () => ({
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

story("an extension reloaded while disabled starts when it is enabled again", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const setups: string[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(() => void setups.push("first"), 0)
    await wait(20)
    host.disable()
    await wait(20)
    host.reload()
    const afterReload = host.status()

    // A load the reload started finishes while the extension is still disabled.
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
      const { mountExtensions, until, createKeyed, createSignal, getOwner, runWithOwner } = await import(fixture)
      const registry = { kind: "registry" as const, id: "fixture-scoped" }
      const scope: Scope = { end: () => {} }

      const host = mountExtensions({
        definitions: [
          {
            id: "fixture",
            renderer: async () => ({
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
    const { mountExtensions, until, Slot } = await import(fixture)
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })

    const host = mountExtensions({
      definitions: [
        {
          id: "fixture",
          renderer: async () => ({
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
          renderer: async () => ({
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

story("an extension that requires a contract starts once it is active and restarts with it", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensions, until, Contract, onCleanup } = await import(fixture)
    const Tree: Contract<{ version: number }, "provider.tree"> = Contract.define("provider.tree")
    const providerLoad = Promise.withResolvers<void>()
    const log: string[] = []
    const versions = { value: 0 }

    const definitions = [
      {
        id: "provider",
        provides: { tree: Tree },
        renderer: async () => {
          await providerLoad.promise

          return { default: (ctx: Context) => void ctx.provide(Tree, { version: ++versions.value }) }
        },
      },
      {
        id: "consumer",
        requires: { tree: Tree },
        renderer: async () => ({
          default: (ctx: Context & { requires: { tree: { version: number } } }) => {
            const version = ctx.requires.tree.version
            log.push(`setup ${version}`)
            onCleanup(() => void log.push(`cleanup ${version}`))
          },
        }),
      },
    ]

    // Hard contracts gate startup: a consumer whose provider is disabled settles the gate without starting.
    const gated = mountExtensions({ definitions: [definitions[1], definitions[0]], disabled: ["provider"] })
    await until(() => gated.ready())
    const blocked = { status: gated.status("consumer"), log: [...log] }
    gated.unmount()

    const failed = mountExtensions({
      definitions: [
        {
          ...definitions[0],
          renderer: async () => {
            throw new Error("provider failed")
          },
        },
        definitions[1],
      ],
    })

    await until(() => failed.ready())
    const failedProvider = { status: failed.status("consumer"), log: [...log] }
    failed.unmount()

    const host = mountExtensions({ definitions })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const waiting = { status: host.status("consumer"), log: [...log] }
    providerLoad.resolve()
    await until(() => host.status("consumer") === "active")
    host.reload("provider")
    await until(() => log.length === 3)
    host.disable(["provider"])
    await until(() => log.length === 4)
    const outcome = { blocked, failedProvider, waiting, log, after: host.status("consumer") }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({
    blocked: { status: "blocked", log: [] },
    failedProvider: { status: "blocked", log: [] },
    waiting: { status: "loading", log: [] },
    log: ["setup 1", "cleanup 1", "setup 2", "cleanup 2"],
    after: "blocked",
  })
})

story("a contract component reads its provider context and preserves reactive props", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { bindExtension, createComponent, createSignal, Contract, mountExtensions, Slot, until, useExtension } =
      await import(fixture)

    const View: Contract<{ View: Component<{ readonly label: string }> }, "provider.view"> =
      Contract.define("provider.view")

    const observed = { context: "", read: () => "", change: () => {}, mounts: 0 }

    const host = mountExtensions({
      definitions: [
        {
          id: "provider",
          provides: { view: View },
          renderer: async () => ({
            default: (ctx: Context) => {
              ctx.provide(View, {
                View: bindExtension((props: { readonly label: string }) => {
                  observed.context = useExtension().id
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
          requires: { view: View },
          renderer: async () => ({
            default: (ctx: Context & { requires: { view: { View: Component<{ readonly label: string }> } } }) => {
              const [label, setLabel] = createSignal("before")
              observed.change = () => setLabel("after")
              ctx.add(Slot, {
                at: "window.bottom",
                render: () =>
                  createComponent(ctx.requires.view.View, {
                    get label() {
                      return label()
                    },
                  }),
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

story("developer settings show a blocked hard dependency instead of loading forever", async ({ page }, info) => {
  await page.evaluate(async (fixture) => {
    const { Contract, mountExtensions, until } = await import(fixture)
    const Tree = Contract.define("provider.tree")

    const host = mountExtensions({
      settings: true,
      disabled: ["provider"],
      definitions: [
        { id: "provider", provides: { tree: Tree }, renderer: async () => ({ default: () => {} }) },
        { id: "consumer", requires: { tree: Tree }, renderer: async () => ({ default: () => {} }) },
      ],
    })

    await until(() => !!host.container.textContent?.includes("consumer"))
  }, fixture)
  const settings = page.getByRole("region", { name: "Extensions", exact: true })
  await settings.screenshot({ path: info.outputPath("requires-status.png") })
  await expect(settings.getByText("Blocked", { exact: true })).toBeVisible()
  await expect(settings.getByText("Loading", { exact: true })).toHaveCount(0)
})

story("blocked chains expose their own reason and recover regardless of definition order", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { Contract, mountExtensions, until } = await import(fixture)
    const Root: Contract<number, "root.value"> = Contract.define("root.value")
    const Branch: Contract<number, "branch.value"> = Contract.define("branch.value")
    const observed = { read: (): Live<number> => ({ status: "pending" }), starts: 0 }

    const host = mountExtensions({
      disabled: ["root"],
      definitions: [
        {
          id: "leaf",
          requires: { branch: Branch },
          renderer: async () => ({
            default: () => {
              observed.starts++
            },
          }),
        },
        {
          id: "observer",
          uses: { branch: Branch },
          renderer: async () => ({
            default: (ctx: Context & { uses: { branch: () => Live<number> } }) => {
              observed.read = ctx.uses.branch
            },
          }),
        },
        {
          id: "branch",
          requires: { root: Root },
          provides: { branch: Branch },
          renderer: async () => ({ default: (ctx: Context) => void ctx.provide(Branch, 2) }),
        },
        {
          id: "root",
          provides: { root: Root },
          renderer: async () => ({ default: (ctx: Context) => void ctx.provide(Root, 1) }),
        },
      ],
    })

    await until(() => host.ready())

    const blocked = {
      branch: host.status("branch"),
      leaf: host.status("leaf"),
      live: observed.read(),
      starts: observed.starts,
    }

    host.disable([])
    await until(() => host.status("leaf") === "active")
    const recovered = { live: observed.read(), starts: observed.starts }
    host.unmount()

    return { blocked, recovered }
  }, fixture)

  expect(result).toEqual({
    blocked: { branch: "blocked", leaf: "blocked", live: { status: "inactive", reason: "blocked" }, starts: 0 },
    recovered: { live: { status: "active", value: 2, generation: 1 }, starts: 1 },
  })
})

const invalidSetups = ["promise", "thenable"]

invalidSetups.forEach((kind) => {
  story(`window setup rejects a returned ${kind}`, async ({ page }) => {
    const result = await page.evaluate(
      async (input) => {
        const { mountExtensions, until } = await import(input.fixture)
        const resume = Promise.withResolvers<void>()
        const done = Promise.withResolvers<void>()
        const registry = { kind: "registry" as const, id: "invalid-setup" }
        const observed = { aborted: false }

        const host = mountExtensions({
          definitions: [
            {
              id: "invalid",
              renderer: async () => ({
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
    const { mountExtensions, until, Schema, Store } = await import(fixture)
    const Prefs = Schema.Struct({ open: Schema.Boolean })
    const seen: unknown[] = []

    const host = mountExtensions({
      stored: { "extension.fixture.prefs": { open: true } },
      definitions: [
        {
          id: "fixture",
          stores: { prefs: Store.global(Prefs, { open: false }) },
          renderer: async () => ({
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
    const { Contract, mountExtensions, until } = await import(fixture)
    const Provider: Contract<number, "disabled.value"> = Contract.define("disabled.value")
    const Dependent: Contract<number, "dependent.value"> = Contract.define("dependent.value")
    const observed = { read: (): Live<number> => ({ status: "pending" }) }
    const initial = Promise.withResolvers<readonly EnableState[]>()
    const reply = Promise.withResolvers<readonly Installed[]>()
    const listeners = new Set<(message: BridgeMessage) => void>()
    const setups: string[] = []

    const list = (disabled: readonly string[]): Installed[] =>
      ["dependent", "enabled", "disabled"].map((id) => ({
        id,
        name: id,
        version: "1",
        builtin: true,
        enabled: !disabled.includes(id),
      }))

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
      manager: {
        initial: initial.promise,
        list: () => reply.promise,
        enable: async () => {},
        disable: async () => {},
        reload: async () => {},
        install: async () => {},
        remove: async () => {},
        source: async () => "",
        asset: () => "",
      },
    }

    const host = mountExtensions({
      bridge,
      // The consumer comes first; the provider's old-id setting arrives asynchronously from the preload.
      definitions: [
        {
          id: "dependent",
          requires: { provider: Provider },
          provides: { value: Dependent },
          renderer: async () => ({
            default: (ctx: Context) => {
              setups.push("dependent")
              ctx.provide(Dependent, 2)
            },
          }),
        },
        {
          id: "enabled",
          uses: { value: Dependent },
          renderer: async () => ({
            default: (ctx: Context & { uses: { value: () => Live<number> } }) => {
              setups.push("enabled")
              observed.read = ctx.uses.value
            },
          }),
        },
        {
          id: "disabled",
          legacy: ["previous"],
          provides: { value: Provider },
          renderer: async () => ({
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
    initial.resolve([{ id: "previous", enabled: false }])
    await until(() => host.ready())

    const started = {
      setups: [...setups],
      status: host.status("disabled"),
      dependent: host.status("dependent"),
      live: observed.read(),
    }

    const unknown: { ready: boolean; setups: string[]; status?: string }[] = []

    // A failed startup reply must not temporarily activate the disabled extension while list() waits.
    for (const failure of ["unknown", "rejected"]) {
      const initial = failure === "unknown" ? Promise.resolve(undefined) : Promise.reject(new Error("snapshot failed"))
      const reply = Promise.withResolvers<readonly Installed[]>()

      const failed = mountExtensions({
        bridge: { ...bridge, manager: { ...bridge.manager, initial, list: () => reply.promise } },
        definitions: [{ id: "disabled", renderer: async () => ({ default: () => void setups.push("wrongly enabled") }) }],
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      const blocked = { ready: failed.ready(), setups: [...setups] }

      reply.resolve(list(["disabled"]))
      await until(() => failed.ready())
      unknown.push({ ...blocked, status: failed.status("disabled") })
      failed.unmount()
    }

    listeners.forEach((listener) => listener({ type: "extensions", list: list(["enabled"]) }))
    await until(
      () =>
        host.status("disabled") === "active" &&
        host.status("enabled") === "disabled" &&
        host.status("dependent") === "active",
    )
    reply.resolve(list(["disabled"]))
    await new Promise((resolve) => setTimeout(resolve, 50))

    const updated = {
      setups: [...setups],
      status: [host.status("enabled"), host.status("disabled"), host.status("dependent")],
    }

    host.unmount()

    return { before, started, unknown, updated, listeners: listeners.size }
  }, fixture)

  expect(result).toEqual({
    before: [],
    started: {
      setups: ["enabled"],
      status: "disabled",
      dependent: "blocked",
      live: { status: "inactive", reason: "blocked" },
    },
    unknown: [
      { ready: false, setups: ["enabled"], status: "disabled" },
      { ready: false, setups: ["enabled"], status: "disabled" },
    ],
    updated: { setups: ["enabled", "disabled", "dependent"], status: ["disabled", "active", "active"] },
    listeners: 0,
  })
})
