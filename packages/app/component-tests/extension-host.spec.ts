import { fileURLToPath } from "node:url"
import type { Context, Dialogs } from "@opencode/gui-extensions/sdk"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./extension-host.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

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
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const cleaned: string[] = []
    const point = { kind: "point" as const, id: "fixture-point" }
    host.load(async (ctx: Context) => {
      ctx.add(point, "before")
      started.resolve()
      await resume.promise
      ctx.add(point, "after")
      ctx.cleanup(() => void cleaned.push("registered"))
      return () => void cleaned.push("returned")
    })
    await started.promise
    const before = host.entries(point.id)
    host.unmount()
    resume.resolve()
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { before, after: host.entries(point.id), cleaned }
  }, fixture)
  expect(result).toEqual({ before: 1, after: 0, cleaned: ["registered", "returned"] })
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
    const services: Dialogs[] = []
    const setup = (ctx: Context) => void services.push(ctx.use({ kind: "host" as const, id: "dialog" }) as Dialogs)
    const text = (value: string) => () => Object.assign(document.createElement("p"), { textContent: value })
    const shown = (value: string) => !!document.body.textContent?.includes(value)
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load(setup, 0)
    await wait(20)
    host.reload()
    host.load(setup, 1)
    await wait(20)
    const [stale, fresh] = services
    stale.push(text("stale dialog"))
    fresh.push(text("fresh dialog"))
    await wait(50)
    stale.close()
    await wait(300)
    const outcome = { stale: shown("stale dialog"), fresh: shown("fresh dialog") }
    host.unmount()
    return outcome
  }, fixture)
  expect(result).toEqual({ stale: false, fresh: true })
})

story("a dialog pushed in the same tick as a reload never mounts", async ({ page }) => {
  const shown = await page.evaluate(async (fixture) => {
    const { mountExtensionHost } = await import(fixture)
    const host = mountExtensionHost()
    const services: Dialogs[] = []
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    host.load((ctx: Context) => void services.push(ctx.use({ kind: "host" as const, id: "dialog" }) as Dialogs), 0)
    await wait(20)
    services[0].push(() => Object.assign(document.createElement("p"), { textContent: "same tick dialog" }))
    host.reload()
    await wait(300)
    const outcome = !!document.body.textContent?.includes("same tick dialog")
    host.unmount()
    return outcome
  }, fixture)
  expect(shown).toBe(false)
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
