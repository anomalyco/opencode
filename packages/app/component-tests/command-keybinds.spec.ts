// Uses the real CommandProvider, global document listener and Settings keybind overrides.
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./command-keybinds.fixture.tsx", import.meta.url))

story(
  "non-Latin fallback respects command context, exact custom bindings and palette priority",
  async ({ mount, page }) => {
    await mount("ui-line-comment--editor")

    const result = await page.evaluate(async (fixture) => {
      const { mountCommands } = await import(fixture)
      const host = await mountCommands()

      try {
        const prevented = [host.send({ key: "а", code: "KeyF", ctrlKey: true })]
        host.context(true)
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true }))
        host.context(false)
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true }))
        host.set("custom", "ctrl+а")
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true }))
        host.set("custom", "ctrl+л")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))
        host.set("custom", "none")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))
        host.set("custom", "ctrl+k")
        host.set("command.palette", "ctrl+л")
        prevented.push(host.send({ key: "л", code: "KeyK", ctrlKey: true }))
        host.set("custom", "ctrl+х")
        prevented.push(host.send({ key: "х", code: "BracketLeft", ctrlKey: true }))
        host.set("custom", "none")
        prevented.push(host.send({ key: "х", code: "BracketLeft", ctrlKey: true }))
        prevented.push(host.send({ key: "х", code: "BracketLeft", ctrlKey: true, isComposing: true }))
        prevented.push(host.send({ key: "“", code: "BracketLeft", metaKey: true, altKey: true }))
        prevented.push(host.send({ key: "х", code: "BracketLeft", ctrlKey: true, altKey: true }))
        prevented.push(
          host.send({ key: "х", code: "BracketLeft", ctrlKey: true, altKey: true, modifierAltGraph: true }),
        )
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true, isComposing: true }))
        prevented.push(host.send({ key: "а", code: "KeyF", ctrlKey: true, modifierAltGraph: true }))

        return { selected: host.selected, prevented }
      } finally {
        host.dispose()
      }
    }, fixture)

    expect(result.selected).toEqual([
      "find",
      "context",
      "find",
      "custom",
      "custom",
      "palette",
      "palette",
      "custom",
      "bracket",
      "bracket",
      "alt-bracket",
      "ctrl-alt-bracket",
      "ctrl-alt-bracket",
    ])
    expect(result.prevented).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ])
  },
)

story("a declining literal or physical command leaves the key to its target", async ({ mount, page }) => {
  await mount("ui-line-comment--editor")

  const result = await page.evaluate(async (fixture) => {
    const { mountCommands } = await import(fixture)
    const host = await mountCommands()

    try {
      host.set("decline", "ctrl+а")
      const literal = host.send({ key: "а", code: "KeyF", ctrlKey: true })
      host.set("decline", "ctrl+f")
      const physical = host.send({ key: "а", code: "KeyF", ctrlKey: true })

      return { selected: host.selected, prevented: [literal, physical] }
    } finally {
      host.dispose()
    }
  }, fixture)

  expect(result.selected).toEqual(["decline", "decline"])
  expect(result.prevented).toEqual([false, false])
})
