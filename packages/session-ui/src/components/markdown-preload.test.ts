import { expect, test } from "bun:test"
import { preloadMarkdown } from "./markdown-cache"

test("preloads completed markdown into the render cache", async () => {
  const parsed: string[] = []
  const parser = {
    parse(text: string) {
      parsed.push(text)
      return `<p>${text}</p>`
    },
  }
  const key = `markdown-preload-${crypto.randomUUID()}`

  await preloadMarkdown("prepared response", key, parser)
  await preloadMarkdown("prepared response", key, parser)

  expect(parsed).toEqual(["prepared response"])
})
