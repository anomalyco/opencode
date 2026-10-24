// Uses the real CommandProvider, global document listener and Settings keybind overrides.
import { expect, sourceURL, story } from "../../storybook/playwright/story"

const fixture = sourceURL(new URL("./command-keybinds.fixture.tsx", import.meta.url))

story(
  "non-Latin fallback dispatches commands and palette while exact custom bindings take priority",
  async ({ mount, page }) => {
    await mount("ui-line-comment--editor")

    const result = await page.evaluate(async (fixture) => {
      const { mountCommands } = await import(fixture)
      const host = await mountCommands()

      try {
        const prevented = [host.send({ key: "а", code: "KeyF", ctrlKey: true })]
        host.set("custom", "ctrl+а")
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true }))
        host.set("custom", "ctrl+л")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))
        host.set("custom", "none")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))
        host.set("custom", "ctrl+k")
        host.set("command.palette", "ctrl+л")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))

        return { selected: host.selected, prevented }
      } finally {
        host.dispose()
      }
    }, fixture)

    expect(result.selected).toEqual(["find", "custom", "custom", "palette", "palette"])
    expect(result.prevented).toEqual([true, true, true, true, true])
  },
)
