import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Info, type Interface } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

test.each([44, 100])("language picker applies and persists selection at width %s", async (width) => {
  await using state = await tmpdir()
  const file = Bun.file(`${state.path}/tui.json`)
  await file.write(JSON.stringify({ animations: false, keybinds: { "opencode.settings": "f6" } }))
  const saving = Promise.withResolvers<void>()
  const saved = Promise.withResolvers<void>()
  const service: Interface = {
    get: async () => Schema.decodeUnknownSync(Info)(await file.json()),
    update: async (update) => {
      saving.resolve()
      await saved.promise
      const draft = { ...(await service.get()) }
      update(draft)
      await file.write(JSON.stringify(draft))
      return Schema.decodeUnknownSync(Info)(draft)
    },
  }
  {
    await using app = await createAppFixture({ width, state: state.path, configService: service })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("commands"))
    app.mockInput.pressKey("F6")
    await app.waitForFrame((frame) => frame.includes("Language"))
    await app.mockInput.typeText("Language")
    await app.waitForFrame((frame) => frame.includes("English"))
    app.mockInput.pressKey("RETURN")
    const picker = await app.waitForFrame((frame) => frame.includes("Русский"))
    expect(picker).toContain("English")
    expect((await service.get()).language).toBeUndefined()
    app.mockInput.pressKey("ESCAPE")
    await app.waitForFrame((frame) => frame.includes("commands"))
    expect((await service.get()).language).toBeUndefined()
    app.mockInput.pressKey("F6")
    await app.waitForFrame((frame) => frame.includes("Language"))
    await app.mockInput.typeText("Language")
    await app.waitForFrame((frame) => frame.includes("English"))
    app.mockInput.pressKey("RETURN")
    await app.waitForFrame((frame) => frame.includes("Русский"))
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.mockInput.typeText("Русский")
    await app.waitForFrame((frame) => (frame.match(/Русский/g)?.length ?? 0) >= 2)
    const highlight = app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .findLast((span) => span.text.includes("Русский"))!.bg
    app.mockInput.pressKey("RETURN")
    await saving.promise
    try {
      await app.renderOnce()
      expect(
        app
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .findLast((span) => span.text.includes("Русский"))!.bg,
      ).toEqual(highlight)
    } finally {
      saved.resolve()
    }
    const russianPicker = await app.waitForFrame((frame) => frame.includes("Язык") && frame.includes("Русский"))
    expect(russianPicker).toContain("Русский")
    expect((await service.get()).language).toBe("ru")
    app.mockInput.pressKey("ESCAPE")
    await app.waitForFrame((frame) => frame.includes("Команды"))
    app.mockInput.pressKey("F6")
    const settings = await app.waitForFrame((frame) => frame.includes("Настройки"))
    expect(settings).toContain("Язык")
    expect(settings).toContain("Русский")
    expect(settings).toContain("Тема")
  }
  {
    await using app = await createAppFixture({ width, state: state.path, configService: service })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("Команды"))
    app.mockInput.pressKey("F6")
    await app.waitForFrame((frame) => frame.includes("Язык"))
    await app.mockInput.typeText("Язык")
    await app.waitForFrame((frame) => frame.includes("Русский"))
    app.mockInput.pressKey("RETURN")
    await app.waitForFrame((frame) => frame.includes("Русский"))
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.mockInput.typeText("English")
    const picker = await app.waitForFrame((frame) => (frame.match(/English/g)?.length ?? 0) >= 2)
    const row = picker.split("\n").findLastIndex((line) => line.includes("English"))
    await app.mockMouse.click(picker.split("\n")[row].indexOf("English"), row)
    const englishPicker = await app.waitForFrame((frame) => frame.includes("Language") && frame.includes("English"))
    expect(englishPicker).toContain("English")
    expect((await service.get()).language).toBe("en")
    app.mockInput.pressKey("ESCAPE")
    await app.waitForFrame((frame) => frame.includes("commands"))
  }
})
