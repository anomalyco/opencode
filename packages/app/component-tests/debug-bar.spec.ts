import { expect, sourceURL, story } from "../../stories/playwright/story"

const modules = {
  fixture: sourceURL(new URL("./plugin-host.fixture.tsx", import.meta.url)),
  debug: sourceURL(new URL("../../gui-plugins/src/debug/index.ts", import.meta.url)),
  renderer: sourceURL(new URL("../../gui-plugins/src/debug/renderer.tsx", import.meta.url)),
}

story.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

// Reloads and updates are fresh mounts over the same storage, so a mount seeded with what the last one wrote is one.
story("the debug bar stays open across a remount until its close button hides it", async ({ page }) => {
  const result = await page.evaluate(async (modules) => {
    const { mountPlugins, until } = await import(modules.fixture)
    const debug = await import(modules.debug)
    const definition = { ...debug.default, id: "debug", windowEntry: () => import(modules.renderer) }
    const bar = (host: { container: HTMLElement }) => host.container.querySelector("aside")

    const close = (host: { container: HTMLElement }) =>
      host.container.querySelector<HTMLButtonElement>('button[aria-label="Hide debug bar"]')

    const first = mountPlugins({
      definitions: [definition],
      stored: { "plugin.debug.bar": { visible: true, motion: false } },
    })

    first.release()
    await until(() => bar(first) !== null)

    const opened = bar(first) !== null

    close(first)?.click()
    await until(() => bar(first) === null)
    await until(() => first.saved()["plugin.debug.bar"]?.visible === false)

    const saved = first.saved()
    first.unmount()

    const second = mountPlugins({ definitions: [definition], stored: saved })
    second.release()
    await until(() => second.ready())

    await new Promise((resolve) => setTimeout(resolve, 100))
    const reopened = bar(second) !== null
    second.unmount()

    return { opened, saved: saved["plugin.debug.bar"], reopened }
  }, modules)

  expect(result).toEqual({ opened: true, saved: { visible: false, motion: false }, reopened: false })
})

story("a feature page's Enabled switch turns that feature on after another feature's page", async ({ page }) => {
  const result = await page.evaluate(
    async (modules) => {
      localStorage.setItem("opencode.motion.panel", JSON.stringify({ x: 0, y: 0, width: 680 }))
      const { motionTuning } = await import(modules.tuning)

      const experiment = (id: string, subsection: string) =>
        motionTuning.toggle(id, { label: subsection, group: "Switches", subsection, experiment: true, value: false })

      const first = experiment("switches.first", "First")
      const second = experiment("switches.second", "Second")
      const { mountPlugins, until } = await import(modules.fixture)
      const debug = await import(modules.debug)
      const definition = { ...debug.default, id: "debug", windowEntry: () => import(modules.renderer) }

      const host = mountPlugins({
        definitions: [definition],
        stored: { "plugin.debug.bar": { visible: true, motion: true } },
      })

      host.release()

      const row = (name: string) =>
        document.querySelector<HTMLButtonElement>(`[data-motion-feature="Switches · ${name}"]`)

      const enabled = (name: string) =>
        document.querySelector<HTMLElement>(`[data-knobs-mount="opencode-motion-Switches · ${name}"] [role="switch"]`)

      await until(() => row("First") !== null)
      row("First")?.click()
      await until(() => !!enabled("First"))
      row("Second")?.click()
      await until(() => !!enabled("Second"))
      enabled("Second")?.click()
      await until(() => first() || second())
      const values = { first: first(), second: second() }
      host.unmount()

      return values
    },
    { ...modules, tuning: sourceURL(new URL("../../ui/src/motion-tuning.ts", import.meta.url)) },
  )

  expect(result).toEqual({ first: false, second: true })
})

story("a feature page's preset chips go through the feature model, modes included", async ({ page }) => {
  const result = page.evaluate(
    async (modules) => {
      localStorage.setItem("opencode.motion.panel", JSON.stringify({ x: 0, y: 0, width: 680 }))
      const { motionTuning } = await import(modules.tuning)
      const meta = { group: "Chips", subsection: "Feature" }

      const alt = motionTuning.mode("chips.alt", { label: "Alt", ...meta })

      // A mode brings rows of its own, as James does.
      motionTuning.number("chips.alt.shift", {
        label: "Shift",
        ...meta,
        when: alt,
        value: 10,
        min: 0,
        max: 20,
        step: 1,
        unit: "px",
      })

      const spring = motionTuning.spring("chips.spring", {
        label: "Spring",
        ...meta,
        when: () => !alt(),
        presets: {
          snappy: { duration: 0.2, bounce: 0 },
          smooth: { duration: 0.3, bounce: 0 },
          calm: { duration: 0.45, bounce: 0 },
        },
      })

      const shipped = spring().duration
      const { mountPlugins, until } = await import(modules.fixture)
      const debug = await import(modules.debug)
      const definition = { ...debug.default, id: "debug", windowEntry: () => import(modules.renderer) }

      const host = mountPlugins({
        definitions: [definition],
        stored: { "plugin.debug.bar": { visible: true, motion: true } },
      })

      host.release()

      const mount = '[data-knobs-mount="opencode-motion-Chips · Feature"]'

      const chip = (name: string) =>
        [...document.querySelectorAll<HTMLElement>(`${mount} .knobs-preset-chip`)].find(
          (item) => item.textContent?.trim() === name,
        )

      const reset = () => document.querySelector<HTMLButtonElement>(`${mount} button[aria-label^="Reset "]`)

      await until(() => !!document.querySelector('[data-motion-feature="Chips · Feature"]'))
      document.querySelector<HTMLButtonElement>('[data-motion-feature="Chips · Feature"]')?.click()
      await until(() => !!chip("Calm"))
      chip("Calm")?.click()
      await until(() => spring().duration === 0.45)
      chip("Alt")?.click()
      await until(() => alt())
      await until(() => !!chip("Snappy"))
      chip("Snappy")?.click()
      await until(() => !alt() && spring().duration === 0.2)
      await until(() => !!chip("Alt"))
      chip("Alt")?.click()
      await until(() => alt())
      await until(() => !!chip("Shipped"))
      chip("Shipped")?.click()
      await until(() => !alt() && spring().duration === shipped)

      // The group's Reset after a preset goes back to Shipped, modes included.
      await until(() => !!chip("Calm"))
      chip("Calm")?.click()
      await until(() => spring().duration === 0.45 && !!reset())
      reset()?.click()
      await until(() => spring().duration === shipped)
      await until(() => !!chip("Alt"))
      chip("Alt")?.click()
      await until(() => alt())

      // The test presses a key on Shift and Reset twice: back to Alt, then to Shipped.
      const shift = () => document.querySelector<HTMLElement>(`${mount} [role="slider"][aria-label="Shift"]`)
      await until(() => !!shift())
      shift()?.focus()
      await until(() => !alt())
      const values = { alt: alt(), shipped: spring().duration === shipped }
      host.unmount()

      return values
    },
    { ...modules, tuning: sourceURL(new URL("../../ui/src/motion-tuning.ts", import.meta.url)) },
  )

  const panel = page.locator('[data-knobs-mount="opencode-motion-Chips · Feature"]')
  const shift = panel.getByRole("slider", { name: "Shift" })

  await shift.and(page.locator(":focus")).waitFor()
  await page.keyboard.press("ArrowRight")
  await expect(panel.getByRole("radio", { name: "Alt, modified" })).toBeChecked()
  await panel.getByRole("button", { name: "Reset Feature" }).click()
  await expect(panel.getByRole("radio", { name: "Alt", exact: true })).toBeChecked()
  await panel.getByRole("button", { name: "Reset Feature" }).click()
  await expect(shift).toHaveCount(0)

  expect(await result).toEqual({ alt: false, shipped: true })
})
