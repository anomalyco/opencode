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

test("skips preloading oversized markdown", async () => {
  const parsed: string[] = []
  const parser = {
    parse(text: string) {
      parsed.push(text)
      return `<p>${text}</p>`
    },
  }

  await preloadMarkdown("a".repeat(40_001), `markdown-preload-size-${crypto.randomUUID()}`, parser)

  expect(parsed).toEqual([])
})

test("skips preloading markdown with very long lines", async () => {
  const parsed: string[] = []
  const parser = {
    parse(text: string) {
      parsed.push(text)
      return `<p>${text}</p>`
    },
  }

  await preloadMarkdown(`${"a".repeat(8_001)}\n`, `markdown-preload-line-${crypto.randomUUID()}`, parser)

  expect(parsed).toEqual([])
})

test("stops background preloading when preload budget is full", async () => {
  const parsed: string[] = []
  const parser = {
    parse(text: string) {
      parsed.push(text)
      return `<p>${text}</p>`
    },
  }

  const base = `markdown-preload-budget-${crypto.randomUUID()}`
  await Array.from({ length: 160 }).reduce<Promise<void>>(
    (work, _, index) =>
      work.then(() => preloadMarkdown(`entry ${index}`, `${base}-${index}`, parser)),
    Promise.resolve(),
  )

  expect(parsed.length).toBeLessThan(160)
})
