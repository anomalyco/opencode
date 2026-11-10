import { expect, test } from "bun:test"
import { pageHead } from "~/lib/head-links"

const css = (name: string) => `<link href="/_build/assets/${name}.css" rel="stylesheet" />`
const js = (name: string) => `<link href="/_build/assets/${name}.js" rel="modulepreload" />`

test("a page's stylesheets stay as they are and are named in its Link header", () => {
  const html = `<html><head>${css("shell-a")}${css("home-b")}${js("entry")}</head><body>${css("late")}</body></html>`
  const page = pageHead(html)
  expect(page.html).toContain(`${css("shell-a")}${css("home-b")}`)
  expect(page.link).toBe(
    "</_build/assets/shell-a.css>; rel=preload; as=style, </_build/assets/home-b.css>; rel=preload; as=style",
  )
})

test("module preloads in the head start at low priority", () => {
  const page = pageHead(`<head>${js("entry")}</head><body>${js("body")}</body>`)
  expect(page.html).toBe(
    `<head><link href="/_build/assets/entry.js" rel="modulepreload" fetchpriority="low" /></head><body>${js("body")}</body>`,
  )
  expect(page.link).toBeUndefined()
})
