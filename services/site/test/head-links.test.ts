import { expect, test } from "bun:test"
import { stylesheetLinks } from "~/lib/head-links"

const css = (name: string) => `<link href="/_build/assets/${name}.css" rel="stylesheet" />`

test("a page's stylesheets in its head are named in its Link header", () => {
  expect(
    stylesheetLinks(`<html><head>${css("shell-a")}${css("home-b")}</head><body>${css("late")}</body></html>`),
  ).toBe("</_build/assets/shell-a.css>; rel=preload; as=style, </_build/assets/home-b.css>; rel=preload; as=style")
})

test("a page without stylesheets in its head gets no Link header", () => {
  expect(stylesheetLinks(`<head></head><body>${css("body")}</body>`)).toBeUndefined()
})
