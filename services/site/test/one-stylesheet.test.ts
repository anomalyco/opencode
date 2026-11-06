import { expect, test } from "bun:test"
import { combineStylesheets } from "~/lib/one-stylesheet"

const css = (name: string) => `<link href="/_build/assets/${name}.css" rel="stylesheet" />`
const js = `<link href="/_build/assets/a.js" rel="modulepreload" />`

test("a page's stylesheets become one link, with no disabled link in the HTML", () => {
  const html = combineStylesheets(`<html><head>${css("a")}${js}${css("b")}</head><body>${css("c")}</body></html>`)
  expect(html).toBe(
    `<html><head><script data-css="a~b">${html.match(/<script data-css="a~b">(.*?)<\/script>/)![1]}</script>` +
      `<link rel="stylesheet" href="/stylesheet/a~b.css" />${js}</head><body>${css("c")}</body></html>`,
  )
  expect(html).not.toMatch(/<link[^>]*disabled/)
})

test("the script adds each original link, disabled, for the chunk loader", () => {
  const html = combineStylesheets(`<head>${css("a")}${css("b")}</head>`)
  const script = html.match(/<script data-css="([^"]+)">(.*?)<\/script>/)!
  const added: { rel: string; disabled: boolean; href: string }[] = []
  const document = {
    currentScript: { dataset: { css: script[1] } },
    createElement: () => ({ rel: "", disabled: false, href: "" }),
    head: { appendChild: (link: (typeof added)[number]) => added.push(link) },
  }
  new Function("document", script[2])(document)
  expect(added).toEqual([
    { rel: "stylesheet", disabled: true, href: "/_build/assets/a.css" },
    { rel: "stylesheet", disabled: true, href: "/_build/assets/b.css" },
  ])
})

test("stylesheets with an inline style between them are left alone", () => {
  const html = `<head>${css("a")}<style>p{}</style>${css("b")}</head>`
  expect(combineStylesheets(html)).toBe(html)
})
