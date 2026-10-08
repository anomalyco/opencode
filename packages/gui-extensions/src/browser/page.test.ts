import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { parseLocator, type Step } from "./locator"
import {
  PAGE_HELPERS,
  PAGE_METHODS,
  PageControl,
  PageCount,
  PageEntries,
  PageInfo,
  PageOutcome,
  PageRead,
  pageCall,
  type PageMethod,
} from "./page"

type Argument =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | readonly string[]
  | readonly Step[]
  | { readonly [key: string]: string }

// The desktop's call: the function declaration from pageCall, applied with `this` as the scope element or window.
const call = (method: PageMethod, self: Node | Window, ...args: Argument[]) =>
  new Function(`return ${pageCall(method)}`)().apply(self, args)

const steps = (locator: string) => parseLocator(locator)

const ids = (method: "all", locator: string, scope: Node | Window = window) =>
  Array.from(call(method, scope, steps(locator), 50), (el: Element) => el.id || el.textContent)

const count = (locator: string, scope: Node | Window = window) =>
  Schema.decodeUnknownSync(PageCount)(call("count", scope, steps(locator)))

const byId = (id: string) => document.getElementById(id)

const shadow = (host: Element | null, html: string) => {
  if (!host) throw new Error("missing shadow host")
  const root = host.attachShadow({ mode: "open" })
  root.innerHTML = html

  return root
}

const box = Element.prototype.getBoundingClientRect

const elementFromPoint = document.elementFromPoint

beforeAll(() => {
  // happy-dom has no layout: give every element a 10×10 box at the origin, so visibility comes from styles alone.
  Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10)
})

afterAll(() => {
  Element.prototype.getBoundingClientRect = box
  document.elementFromPoint = elementFromPoint
})

beforeEach(() => {
  document.body.innerHTML = ""
  // happy-dom's hit test always returns null; tests that need one stub it.
  document.elementFromPoint = elementFromPoint
})

test("the library defines exactly the methods PageMethod names", () => {
  const api = new Function(`return (${PAGE_HELPERS})()`)()
  expect(Object.keys(api).sort()).toEqual([...PAGE_METHODS].sort())
})

describe("css", () => {
  test("searches open shadow roots recursively, in document order", () => {
    document.body.innerHTML = `<div id="host"></div><button class="b" id="light">Light</button>`
    const root = shadow(byId("host"), `<button class="b" id="shadow">Shadow</button><div id="inner"></div>`)
    shadow(root.getElementById("inner"), `<button class="b" id="deep">Deep</button>`)

    expect(ids("all", ".b")).toEqual(["shadow", "deep", "light"])
    expect(count("button")).toEqual({ count: 3, visible: 3 })
  })

  test("reports an invalid selector with the engine syntax", () => {
    expect(() => call("count", window, steps("button["))).toThrow(/Invalid CSS selector.*text=Save/)
  })
})

describe("text", () => {
  test("keeps only the innermost matching elements and skips scripts", () => {
    document.body.innerHTML = `
      <button id="save"><span id="label">Save</span></button>
      <p id="note">Saved drafts</p>
      <script>var Save = 1</script>
      <style>.Save {}</style>`

    expect(ids("all", "text=save")).toEqual(["label", "note"])
    expect(ids("all", 'text="Save"')).toEqual(["label"])
    expect(ids("all", 'text="save"')).toEqual([])
  })

  test("matches text split across child elements and blocks", () => {
    document.body.innerHTML = `
      <div id="usage"><span>Used</span> <b>37</b> of 100</div>
      <div id="pair"><div>Alpha</div><div>Beta</div></div>
      <input id="send" type="submit" value="Send it">`

    expect(ids("all", "text=used 37")).toEqual(["usage"])
    expect(ids("all", 'text="Used 37 of 100"')).toEqual(["usage"])
    expect(ids("all", "text=Alpha Beta")).toEqual(["pair"])
    expect(ids("all", "text=send it")).toEqual(["send"])
  })

  test("reads shadow content and slotted light children", () => {
    document.body.innerHTML = `<div id="host"><b id="slotted">World</b></div>`
    shadow(byId("host"), `<span id="greeting">Hello </span><slot></slot>`)

    expect(ids("all", "text=Hello World")).toEqual(["host"])
    expect(ids("all", 'text="World"')).toEqual(["slotted"])
  })
})

describe("role", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header id="banner">Top</header>
      <nav id="nav"><a id="docs" href="/docs">Docs</a><a id="anchor">Not a link</a></nav>
      <main id="main">
        <header id="inner-header">Inner</header>
        <h2 id="settings">Settings</h2>
        <button id="draft">Save draft</button>
        <div id="close" role="button tab" aria-label="Close dialog"></div>
        <details id="more"><summary id="summary">More</summary></details>
        <input id="remember" type="checkbox"><label for="remember">Remember me</label>
        <input id="email" type="text" aria-label="Email">
        <input id="search" type="search">
        <input id="amount" type="number">
        <input id="volume" type="range">
        <textarea id="notes"></textarea>
        <div id="editor" contenteditable="true">Editor</div>
        <select id="single"><option>One</option></select>
        <select id="many" multiple><option>Two</option></select>
        <ul id="list"><li id="item">Item</li></ul>
        <table id="table"><tr id="head-row"><th id="th">H</th></tr><tr><td id="td">C</td></tr></table>
        <img id="logo" alt="Logo" src="logo.png">
        <progress id="progress"></progress>
      </main>
      <footer id="footer">Bottom</footer>`
  })

  test.each([
    ["role=link", ["docs"]],
    ["role=heading", ["settings"]],
    ["role=button", ["draft", "close", "summary"]],
    ['role=button[name="Save draft"]', ["draft"]],
    ["role=button[name=save]", ["draft"]],
    ['role=button[name="save"]', []],
    ['role=button[name="close" i]', ["close"]],
    ['role=checkbox[name="Remember me"]', ["remember"]],
    ["role=textbox", ["email", "notes", "editor"]],
    ["role=textbox[name=email]", ["email"]],
    ["role=searchbox", ["search"]],
    ["role=spinbutton", ["amount"]],
    ["role=slider", ["volume"]],
    ["role=combobox", ["single"]],
    ["role=listbox", ["many"]],
    ["role=list", ["list"]],
    ["role=listitem", ["item"]],
    ["role=table", ["table"]],
    ["role=row", ["head-row", ""]],
    ["role=columnheader", ["th"]],
    ["role=cell", ["td"]],
    ['role=img[name="Logo"]', ["logo"]],
    ["role=progressbar", ["progress"]],
    ["role=group", ["more"]],
    ["role=navigation", ["nav"]],
    ["role=main", ["main"]],
    ["role=banner", ["banner"]],
    ["role=contentinfo", ["footer"]],
  ])("%s", (locator, expected) => {
    expect(Array.from(call("all", window, steps(locator), 50), (el: Element) => el.id)).toEqual(expected)
  })
})

describe("label", () => {
  test("matches for=, wrapping labels, aria-labelledby, and aria-label", () => {
    document.body.innerHTML = `
      <label for="email">Email address</label><input id="email">
      <label>Password <input type="password" id="password"></label>
      <span id="phone-label">Phone</span><input id="phone" aria-labelledby="phone-label">
      <input id="zip" aria-label="ZIP code">
      <button id="close" aria-label="Close">×</button>
      <label>Country <select id="country"><option>United States</option></select></label>`

    expect(ids("all", "label=email")).toEqual(["email"])
    expect(ids("all", 'label="Password"')).toEqual(["password"])
    expect(ids("all", "label=phone")).toEqual(["phone"])
    expect(ids("all", "label=zip")).toEqual(["zip"])
    expect(ids("all", "label=close")).toEqual(["close"])
    expect(ids("all", 'label="Country"')).toEqual(["country"])
    expect(ids("all", "label=United States")).toEqual([])
  })
})

test("placeholder and testid", () => {
  document.body.innerHTML = `
    <input id="search" placeholder="Search docs"><textarea id="notes" placeholder="Notes"></textarea>
    <div id="a1" data-testid="a"></div><div id="a2" data-test-id="a"></div><div id="a3" data-test="a"></div>
    <div id="ab" data-testid="ab"></div>`

  expect(ids("all", "placeholder=search")).toEqual(["search"])
  expect(ids("all", 'placeholder="Notes"')).toEqual(["notes"])
  expect(ids("all", 'placeholder="notes"')).toEqual([])
  expect(ids("all", "testid=a")).toEqual(["a1", "a2", "a3"])
  expect(ids("all", "testid=b")).toEqual([])
})

describe("chaining", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="one"><li>A</li><li>B</li></ul>
      <ul id="two"><li>C</li><li>D</li></ul>
      <div id="outer"><span id="s1"></span><div id="inner"><span id="s2"></span></div><span id="s3"></span></div>`
  })

  test.each([
    ["ul >> li", ["A", "B", "C", "D"]],
    ["ul >> li >> nth=-1", ["D"]],
    ["ul >> nth=1 >> li", ["C", "D"]],
    ["li >> nth=0", ["A"]],
    ["li >> nth=4", []],
    ["li >> nth=-5", []],
    ["#two >> text=D", ["D"]],
    ["#outer >> div >> span", ["s2"]],
    ["div >> span", ["s1", "s2", "s3"]],
    ["div >> :scope > span", ["s1", "s2", "s3"]],
  ])("%s", (locator, expected) => {
    expect(ids("all", locator)).toEqual(expected)
  })

  test("searches inside the scope element passed as this", () => {
    expect(ids("all", "li", byId("two") ?? window)).toEqual(["C", "D"])
    expect(count("li >> nth=0", byId("two") ?? window)).toEqual({ count: 1, visible: 1 })
    expect(call("first", byId("two") ?? window, [])).toBe(byId("two"))
  })
})

describe("visibility", () => {
  test("first prefers the first visible match, then the first match, then null", () => {
    document.body.innerHTML = `
      <button id="none" style="display:none">Go</button>
      <div style="opacity:0"><button id="faded">Go</button></div>
      <button id="invisible" style="visibility:hidden">Go</button>
      <div style="display:none"><button id="nested">Go</button></div>
      <button id="shown">Go</button>`

    expect(call("first", window, steps("text=Go"))).toBe(byId("shown"))
    expect(count("text=Go")).toEqual({ count: 5, visible: 1 })
    byId("shown")?.remove()
    expect(call("first", window, steps("text=Go"))).toBe(byId("none"))
    expect(call("first", window, steps("text=Stop"))).toBeNull()
  })
})

describe("info", () => {
  test("returns the requested fields", () => {
    document.body.innerHTML = `<a id="docs" class="x" href="https://example.com/docs" style="color: red">Read the <b>docs</b></a>`
    const docs = byId("docs")

    if (!docs) throw new Error("missing #docs")

    expect(
      Schema.decodeUnknownSync(PageInfo)(call("info", window, docs, ["text", "box", "attributes", "html"], ["color"])),
    ).toEqual({
      tag: "a",
      role: "link",
      name: "Read the docs",
      visible: true,
      text: "Read the docs",
      box: { x: 0, y: 0, width: 10, height: 10 },
      attributes: { id: "docs", class: "x", href: "https://example.com/docs", style: "color: red" },
      html: '<a id="docs" class="x" href="https://example.com/docs" style="color: red">Read the <b>docs</b></a>',
      styles: { color: "red" },
    })
    expect(Schema.decodeUnknownSync(PageInfo)(call("info", window, docs))).toEqual({
      tag: "a",
      role: "link",
      name: "Read the docs",
      visible: true,
    })
  })

  test("reads values and clips long text", () => {
    document.body.innerHTML = `<input id="field" value="hello"><p id="long">${"word ".repeat(100)}</p>`
    const field = Schema.decodeUnknownSync(PageInfo)(call("info", window, byId("field"), ["value"]))
    const long = Schema.decodeUnknownSync(PageInfo)(call("info", window, byId("long"), ["text"]))

    expect(field.value).toBe("hello")
    expect(long.text?.length).toBe(300)
    expect(long.text?.endsWith("…")).toBe(true)
  })

  test("names and describes elements", () => {
    document.body.innerHTML = `
      <button id="save" class="primary wide large">Save</button>
      <label for="q">Query</label><input id="q" placeholder="Search">
      <input id="p" placeholder="Search">
      <button id="icon"><img alt="Close"></button>`

    expect(call("name", window, byId("q"))).toBe("Query")
    expect(call("name", window, byId("p"))).toBe("Search")
    expect(call("name", window, byId("icon"))).toBe("Close")
    expect(call("describe", window, byId("save"))).toBe('button#save.primary.wide "Save"')
  })
})

describe("read", () => {
  test("converts the DOM to Markdown", () => {
    document.body.innerHTML = `
      <h1>Title</h1>
      <p>Hello <strong>bold</strong> and <em>soft</em> <a href="https://example.com/docs">docs</a> with <code>x()</code>.</p>
      <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
      <ol start="3"><li>Third</li><li>Fourth</li></ol>
      <table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Apple</td><td>2 | 3</td></tr></tbody></table>
      <pre><code class="language-js">const a = 1;
const b = 2;</code></pre>
      <blockquote><p>Quoted</p></blockquote>
      <p>Line<br>break</p>
      <img alt="Logo" src="https://example.com/logo.png"><img src="https://example.com/spacer.gif">
      <script>ignored()</script><style>.x {}</style>
      <div style="display:none">hidden</div><div hidden>also hidden</div><div aria-hidden="true">aria hidden</div>`

    expect(Schema.decodeUnknownSync(PageRead)(call("read", window, "markdown")).text).toBe(
      [
        "# Title",
        "Hello **bold** and *soft* [docs](https://example.com/docs) with `x()`.",
        "- One\n- Two\n  - Nested",
        "3. Third\n4. Fourth",
        "| Name | Qty |\n| --- | --- |\n| Apple | 2 \\| 3 |",
        "```js\nconst a = 1;\nconst b = 2;\n```",
        "> Quoted",
        "Line\nbreak",
        "![Logo](https://example.com/logo.png)",
      ].join("\n\n"),
    )
  })

  test("reads visible text, cut between phrases", () => {
    document.body.innerHTML = `
      <h1>Title</h1><p>Hello <b>world</b></p><script>bad()</script>
      <div style="display:none">secret</div><p>End</p><section id="part"><p>Only this</p></section>`
    const text = Schema.decodeUnknownSync(PageRead)(call("read", window, "text")).text

    expect(text).toContain("Title")
    expect(text).toContain("Hello world")
    expect(text).not.toContain("bad()")
    expect(text).not.toContain("secret")
    expect(call("read", window, "text", "title", "END")).toEqual({ text: "Hello world", totalChars: 11 })
    expect(call("read", window, "text", "hello", "nowhere").text).toBe("world\nEnd\nOnly this")
    expect(call("read", byId("part") ?? window, "text")).toEqual({ text: "Only this", totalChars: 9 })
    expect(() => call("read", window, "text", "missing phrase")).toThrow(/"missing phrase" \(after\) does not occur/)
  })

  test("reads text inside open shadow roots, which innerText leaves out", () => {
    document.body.innerHTML = `<p>Light <a href="https://example.com">link</a></p><div id="host"></div>`
    shadow(
      byId("host"),
      `<h2>Shadow title</h2><ul><li>One</li><li>Two</li></ul><table><tr><td>a</td><td>b</td></tr></table>`,
    )

    expect(call("read", window, "text")).toEqual({
      text: "Light link\nShadow title\nOne\nTwo\na\tb",
      totalChars: 35,
    })
  })

  test("paginates with offset and maxChars", () => {
    document.body.innerHTML = `<p>abcdefghij</p>`

    expect(call("read", window, "text", undefined, undefined, 2, 3)).toEqual({
      text: "cde",
      totalChars: 10,
      nextOffset: 5,
    })
    expect(call("read", window, "text", undefined, undefined, 8, 5)).toEqual({ text: "ij", totalChars: 10 })
  })
})

describe("forms", () => {
  test("select picks options by value or visible label", () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="us">United States</option><option value="ca">Canada</option><option value="mx" disabled>Mexico</option>
      </select>
      <select id="many" multiple><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>`
    const country = byId("country")

    if (!(country instanceof HTMLSelectElement)) throw new Error("missing #country")
    const events: string[] = []
    country.addEventListener("input", () => events.push("input"))
    country.addEventListener("change", () => events.push("change"))

    const select = (el: Element | null, values: readonly string[]) =>
      Schema.decodeUnknownSync(PageOutcome)(call("select", window, el, values))

    expect(select(country, ["ca"])).toEqual({ ok: true })
    expect(country.value).toBe("ca")
    expect(events).toEqual(["input", "change"])
    expect(select(country, [" united states "])).toEqual({ ok: true })
    expect(country.value).toBe("us")
    expect(select(country, ["Mexico"])).toEqual({
      ok: false,
      reason:
        'no enabled option matches "Mexico"; options: "United States" (value "us"), "Canada" (value "ca"), "Mexico" (value "mx") (disabled)',
    })
    expect(select(country, ["us", "ca"])).toEqual({ ok: false, reason: "this <select> takes exactly one value" })
    expect(select(byId("many"), ["a", "C"])).toEqual({ ok: true })
    expect(Array.from(byId("many")?.querySelectorAll("option") ?? [], (option) => option.selected)).toEqual([
      true,
      false,
      true,
    ])
    expect(select(document.body, ["a"]).ok).toBe(false)
  })

  test("control and checked describe how to set a value", () => {
    document.body.innerHTML = `
      <input id="box" type="checkbox" checked><input id="date" type="date"><input id="text">
      <div id="switch" role="switch" aria-checked="false"></div><div id="editor" contenteditable="true"></div>
      <select id="many" multiple></select><input id="files" type="file" multiple>`
    const control = (id: string) => Schema.decodeUnknownSync(PageControl)(call("control", window, byId(id)))

    expect(control("box")).toEqual({ kind: "checkbox", checked: true })
    expect(control("date")).toEqual({ kind: "date" })
    expect(control("text")).toEqual({ kind: "text" })
    expect(control("switch")).toEqual({ kind: "switch", checked: false })
    expect(control("editor")).toEqual({ kind: "contenteditable" })
    expect(control("many")).toEqual({ kind: "select", multiple: true })
    expect(control("files")).toEqual({ kind: "file", multiple: true })
    expect(call("checked", window, byId("box"))).toBe(true)
    expect(call("checked", window, byId("switch"))).toBe(false)
    expect(call("checked", window, byId("text"))).toBeNull()
  })

  test("setValue sets structured inputs through the native setter", () => {
    document.body.innerHTML = `<input id="color" type="color">`
    const color = byId("color")

    if (!(color instanceof HTMLInputElement)) throw new Error("missing #color")
    const events: string[] = []
    color.addEventListener("change", () => events.push("change"))

    expect(Schema.decodeUnknownSync(PageOutcome)(call("setValue", window, color, "#00FF00"))).toEqual({ ok: true })
    expect(color.value).toBe("#00ff00")
    expect(events).toEqual(["change"])
    expect(Schema.decodeUnknownSync(PageOutcome)(call("setValue", window, document.body, "x")).ok).toBe(false)
  })
})

describe("actionable", () => {
  const actionable = async (id: string, action: string) =>
    Schema.decodeUnknownSync(PageOutcome)(await call("actionable", window, byId(id), action))

  test("reports the first failed check", async () => {
    document.body.innerHTML = `
      <button id="save">Save</button><button id="off" disabled>Off</button>
      <fieldset disabled><input id="locked"></fieldset><div aria-disabled="true"><button id="aria">A</button></div>
      <input id="readonly" readonly><button id="gone" style="display:none">Gone</button>
      <div id="backdrop" class="modal-backdrop"></div>`
    document.elementFromPoint = () => byId("backdrop")

    expect(await actionable("off", "click")).toEqual({ ok: false, reason: "disabled" })
    expect(await actionable("locked", "fill")).toEqual({ ok: false, reason: "disabled" })
    expect(await actionable("aria", "click")).toEqual({ ok: false, reason: "disabled" })
    expect(await actionable("readonly", "type")).toEqual({ ok: false, reason: "not editable" })
    expect(await actionable("gone", "hover")).toEqual({ ok: false, reason: "not visible" })
    expect(await actionable("save", "click")).toEqual({ ok: false, reason: "covered by div#backdrop.modal-backdrop" })
    expect(await actionable("save", "fill")).toEqual({ ok: false, reason: "not editable" })
  })

  test("passes when the element receives the pointer", async () => {
    document.body.innerHTML = `<button id="save"><span id="inside">Save</span></button><input id="name">`
    document.elementFromPoint = () => byId("inside")

    expect(await actionable("save", "click")).toEqual({ ok: true })
    expect(await actionable("name", "fill")).toEqual({ ok: true })
    document.elementFromPoint = elementFromPoint
    expect(await actionable("save", "hover")).toEqual({ ok: false, reason: "outside the viewport" })
  })
})

test("textPresent matches normalized text across elements and shadow roots", () => {
  document.body.innerHTML = `<p><span>Used</span> <b>37</b></p><div style="display:none">Secret code</div><div id="host"></div>`
  shadow(byId("host"), `<p>Shadow words</p>`)

  expect(call("textPresent", window, "used   37", true)).toBe(true)
  expect(call("textPresent", window, "Secret code", true)).toBe(false)
  expect(call("textPresent", window, "secret code", false)).toBe(true)
  expect(call("textPresent", window, "shadow words", true)).toBe(true)
  expect(call("textPresent", window, "absent", false)).toBe(false)
})

test("storage reads, writes, and clears entries", () => {
  localStorage.clear()

  const storage = (...args: Argument[]) =>
    Schema.decodeUnknownSync(PageEntries)(call("storage", window, "local", ...args))

  expect(storage("set", { a: "1", b: "2" })).toEqual([
    { name: "a", value: "1" },
    { name: "b", value: "2" },
  ])
  expect(storage("get")).toEqual([
    { name: "a", value: "1" },
    { name: "b", value: "2" },
  ])
  expect(storage("get", undefined, ["b", "missing"])).toEqual([{ name: "b", value: "2" }])
  expect(storage("clear", undefined, ["a"])).toEqual([])
  expect(storage("get")).toEqual([{ name: "b", value: "2" }])
  expect(storage("clear")).toEqual([])
  expect(localStorage.length).toBe(0)
  expect(call("storage", window, "session", "get")).toEqual([])
})

test("idle measures time since the last DOM mutation", async () => {
  expect(call("idle", window)).toBe(0)
  await Bun.sleep(40)
  expect(call("idle", window)).toBeGreaterThanOrEqual(30)
  document.body.append(document.createElement("div"))
  await Bun.sleep(0)
  expect(call("idle", window)).toBeLessThan(30)
})

test("suggest ranks visible interactive elements by word overlap", () => {
  document.body.innerHTML = `
    <a href="/docs">Docs</a><button>Cancel</button><button>Save draft</button>
    <button style="display:none">Save hidden</button><input placeholder="Email">`

  expect(call("suggest", window, 'role=button[name="Save"]', 3)).toEqual([
    'button "Save draft"',
    'button "Cancel"',
    'link "Docs"',
  ])
  expect(call("suggest", window, "email", 1)).toEqual(['textbox "Email"'])
})
