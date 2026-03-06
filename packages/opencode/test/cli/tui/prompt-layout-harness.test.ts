import { expect, test } from "bun:test"
import path from "node:path"

test("prompt bar keeps legacy layout when animation config is absent", async () => {
  const file = await Bun.file(path.join(import.meta.dir, "../../../src/cli/cmd/tui/component/prompt/index.tsx")).text()

  expect(file).toContain("tuiConfig.prompt_bar_animation?.enabled ?? false")
  expect(file).toContain("<Show when={!promptBarAnimationEnabled()}>")
  expect(file).toContain('border={["bottom"]}')
  expect(file).toContain('horizontal: "▀"')
  expect(file).toContain("focusedBackgroundColor={promptBarBackground()}")
})

test("prompt bar keeps animated branch wired when animation is enabled", async () => {
  const file = await Bun.file(path.join(import.meta.dir, "../../../src/cli/cmd/tui/component/prompt/index.tsx")).text()

  expect(file).toContain("backgroundColor={promptBarAnimationEnabled() ? promptBarBackground() : undefined}")
  expect(file).toContain("pluginEnabled: promptBarAnimationEnabled")
  expect(file).toContain("plugin: promptBarAnimationPlugin")
  expect(file).toContain("prompt.animation.choose")
  expect(file).toContain("prompt.animation.cycle")
  expect(file).toContain("prompt.animation.reset")
})
