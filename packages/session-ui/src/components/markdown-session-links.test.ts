import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { markSessionLinks, sessionReferenceClipboardText, setupSessionLinks } from "./markdown-session-links"

const first = "ses_0123456789abcdefghijklmnop"

const second = "ses_abcdefghijklmnopqrstuvwxyz"

const title = (id: string) => ({ [first]: "Auth middleware", [second]: "Release notes" })[id]

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

test("links complete IDs in prose and inline code without changing fenced code or existing links", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>Open ${first}, then <code>${second}</code>. See <a href="/docs">${first}</a>.</p><pre><code>${first}</code></pre>`
  markSessionLinks(root, title)

  const links = root.querySelectorAll<HTMLButtonElement>("button[data-session-id]")
  expect([...links].map((button) => button.dataset.sessionId)).toEqual([first, second])
  expect(links[0]?.textContent).toBe("@Auth middleware")
  expect(links[1]?.textContent).toBe("@Release notes")
  expect(root.querySelector("pre button")).toBeNull()
  expect(root.querySelector("a button")).toBeNull()
  expect(root.textContent).toBe(`Open @Auth middleware, then @Release notes. See ${first}.${first}`)
})

test("ignores incomplete IDs, identifiers, code snippets and IDs in URLs", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>ses_123 and x${first} and ${first}more and <code>${first}extra</code> and <a href="https://example.com/${first}">${first}</a></p>`
  markSessionLinks(root, title)
  expect(root.querySelector("button")).toBeNull()
})

test("does not link an unparsed fenced block while the markdown worker is pending", () => {
  const root = document.createElement("div")
  root.innerHTML = `\`\`\`text<br>${first}<br>\`\`\``
  markSessionLinks(root, title)
  expect(root.querySelector("button")).toBeNull()
})

test("delegates keyboard-activated clicks to the latest rendered ID", () => {
  const root = document.createElement("div")
  const opened: string[] = []
  const dispose = setupSessionLinks(root, () => (id) => opened.push(id))
  root.innerHTML = `<p>${first}</p>`
  markSessionLinks(root, title)
  root.querySelector("button")?.click()
  root.innerHTML = `<p><code>${second}</code></p>`
  markSessionLinks(root, title)
  root.querySelector("button")?.click()
  expect(opened).toEqual([first, second])
  expect(root.querySelector("button")?.getAttribute("type")).toBe("button")
  dispose()
  root.querySelector("button")?.click()
  expect(opened).toEqual([first, second])
})

test("unknown IDs stay mono; tokens and bare IDs follow current titles and deletion", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>@session:${first} and ${second} and ses_short</p>`
  markSessionLinks(root, (id) => (id === first ? "Original" : undefined))
  expect(root.querySelector("button")?.textContent).toBe("@Original")
  expect(root.querySelector("code")?.textContent).toBe(second)
  expect(root.querySelectorAll("button").length).toBe(1)
  markSessionLinks(root, () => "Renamed <session>")
  expect([...root.querySelectorAll("button")].map((link) => link.textContent)).toEqual([
    "@Renamed <session>",
    "@Renamed <session>",
  ])
  expect(root.querySelector("session")).toBeNull()
  markSessionLinks(root, () => undefined)
  expect(root.querySelector("button")).toBeNull()
  expect([...root.querySelectorAll("code")].map((code) => code.textContent)).toEqual([`@session:${first}`, second])
})

test("right-clicking a linked or plain reference opens its menu at the pointer", () => {
  const root = document.createElement("div")
  const menus: { sessionID: string; x: number; y: number }[] = []

  const dispose = setupSessionLinks(
    root,
    () => undefined,
    () => (input) => menus.push(input),
  )

  root.innerHTML = `<p>${first} and ${second}</p>`
  markSessionLinks(root, (id) => (id === first ? "Auth middleware" : undefined))
  const link = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 34 })
  root.querySelector("button")?.dispatchEvent(link)
  const plain = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 })
  root.querySelector("code")?.dispatchEvent(plain)
  const prose = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  root.querySelector("p")?.dispatchEvent(prose)
  expect(menus).toEqual([
    { sessionID: first, x: 12, y: 34 },
    { sessionID: second, x: 5, y: 6 },
  ])
  expect([link.defaultPrevented, plain.defaultPrevented, prose.defaultPrevented]).toEqual([true, true, false])
  dispose()
})

test("a reference keeps the native menu when the host has none", () => {
  const root = document.createElement("div")
  const dispose = setupSessionLinks(root, () => undefined)
  root.innerHTML = `<p>${first}</p>`
  markSessionLinks(root, title)
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  root.querySelector("button")?.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  dispose()
})

test("copied text writes each selected reference as its source instead of its title", () => {
  const root = document.createElement("div")
  document.body.append(root)
  root.innerHTML = `<p>Open @session:${first}, then <code>${second}</code>.</p><p>Plain</p>`
  markSessionLinks(root, title)
  const range = document.createRange()
  range.selectNodeContents(root.querySelector("p")!)
  expect(sessionReferenceClipboardText(root, [range])).toBe(`Open @session:${first}, then ${second}.`)
  expect(root.childElementCount).toBe(2)
  range.selectNodeContents(root.querySelector("button")!)
  expect(sessionReferenceClipboardText(root, [range])).toBe(`@session:${first}`)
  const plain = document.createRange()
  plain.selectNodeContents(root.querySelectorAll("p")[1]!)
  expect(sessionReferenceClipboardText(root, [plain])).toBeUndefined()
  root.remove()
})
