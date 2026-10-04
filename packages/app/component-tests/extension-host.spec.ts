import type { Owner } from "solid-js"
import type { Context, Contract, DialogHandle, Dialogs, SessionRef } from "@opencode/gui-extensions/sdk"
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

story("an async setup that resolves after the host unmounts releases everything it registers", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExtensionHost, onCleanup } = await import(fixture)
    const host = mountExtensionHost()
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const cleaned: string[] = []
    const point = { kind: "point" as const, id: "fixture-point" }
    const resumed = { aborted: false }
    host.load(async (ctx: Context) => {
      ctx.add(point, "before")
      onCleanup(() => void cleaned.push("owner"))
      started.resolve()
      await resume.promise
      // After an await there is no owner: the signal tells the setup it outlived its instance.
      resumed.aborted = ctx.signal.aborted
      ctx.add(point, "after")
    })
    await started.promise
    const before = host.entries(point.id)
    host.unmount()
    resume.resolve()
    await new Promise((resolve) => setTimeout(resolve, 100))

    return { before, after: host.entries(point.id), cleaned, aborted: resumed.aborted }
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
      const inputs: Partial<Record<keyof typeof mounts, { readonly session: { readonly id: string } }>> = {}
      const kept: Kept = {}
      const node = () => document.createElement("p")

      // One render of each kind the host has: a selected tab, a group that stays mounted, and a slot.
      const render = (kind: keyof typeof mounts) => (input: { readonly session: { readonly id: string } }) => {
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
        kept: session?.id,
        fresh: kept.ctx?.sessions.current() !== session,
        screen: { same: kept.ctx?.screen.current() === screen, session: screen?.session?.id },
      })

      const steps = [seen()]
      host.route("b")
      steps.push(seen())
      // An action through the screen targets the session routed now.
      screen?.composer.attach({ type: "file", path: "notes.md" })
      host.route("a")
      steps.push(seen())
      host.unmount()

      return { steps, attached: host.attached }
    }, fixture)

    const step = (id: string, fresh: boolean) => ({
      mounts: { single: 1, grouped: 1, slot: 1 },
      sessions: [id, id, id],
      kept: "a",
      fresh,
      screen: { same: true, session: id },
    })

    // Routing A again makes a new object for the new visit; the kept one still names A.
    expect(result).toEqual({ steps: [step("a", false), step("b", true), step("a", true)], attached: ["b"] })
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

                prefs.update((draft) => ({ count: draft.count + 1 }))
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
      const point = { kind: "point" as const, id: "fixture-scoped" }
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
                  ctx.add(point, "during")
                })
              },
            }),
          },
        ],
      })

      await until(() => host.status("fixture") === "active")
      const during = host.entries(point.id)
      scope.end()
      const ended = host.entries(point.id)
      // A captured owner of a generation that ended, as async work resuming late would hold.
      runWithOwner(scope.owner, () => scope.ctx?.add(point, "late"))
      const late = host.entries(point.id)
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
    const gated = mountExtensions({ definitions, disabled: ["provider"] })
    await until(() => gated.ready())
    const blocked = { status: gated.status("consumer"), log: [...log] }
    gated.unmount()

    const host = mountExtensions({ definitions })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const waiting = { status: host.status("consumer"), log: [...log] }
    providerLoad.resolve()
    await until(() => host.status("consumer") === "active")
    host.reload("provider")
    await until(() => log.length === 3)
    host.disable(["provider"])
    await until(() => log.length === 4)
    const outcome = { blocked, waiting, log, after: host.status("consumer") }
    host.unmount()

    return outcome
  }, fixture)

  expect(result).toEqual({
    blocked: { status: "loading", log: [] },
    waiting: { status: "loading", log: [] },
    log: ["setup 1", "cleanup 1", "setup 2", "cleanup 2"],
    after: "loading",
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
