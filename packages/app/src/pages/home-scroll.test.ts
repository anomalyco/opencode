import { describe, expect, test } from "bun:test"
import { shouldBlockHomeWheel } from "./home-scroll"

function dimensions(element: HTMLElement, input: { top?: number; height: number; content: number }) {
  Object.defineProperties(element, {
    scrollTop: { value: input.top ?? 0, writable: true },
    clientHeight: { value: input.height },
    scrollHeight: { value: input.content },
  })
  return element
}

function blocks(target: HTMLElement, viewport: HTMLElement, deltaY = 40) {
  return shouldBlockHomeWheel({
    target,
    viewport,
    deltaY,
    ctrlKey: false,
    defaultPrevented: false,
  })
}

describe("shouldBlockHomeWheel", () => {
  test("leaves passive homepage regions to native scrolling", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    expect(blocks(document.createElement("div"), viewport)).toBe(false)
  })

  test("blocks interactive elements owned by the homepage viewport", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    viewport.dataset.scrollable = ""
    const button = document.createElement("button")
    const icon = document.createElement("span")
    button.append(icon)
    viewport.append(button)
    expect(blocks(icon, viewport)).toBe(true)

    const link = document.createElement("a")
    link.href = "/session"
    viewport.append(link)
    expect(blocks(link, viewport)).toBe(true)

    const textbox = document.createElement("div")
    textbox.role = "textbox"
    viewport.append(textbox)
    expect(blocks(textbox, viewport)).toBe(true)
  })

  test("allows native scrolling over session rows", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    viewport.dataset.scrollable = ""
    const session = document.createElement("button")
    session.dataset.component = "home-session-row"
    const title = document.createElement("span")
    session.append(title)
    viewport.append(session)
    expect(blocks(title, viewport)).toBe(false)
  })

  test("allows an overflowing nested viewport to scroll over interactive rows", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    viewport.dataset.scrollable = ""
    const projects = dimensions(document.createElement("div"), { height: 100, content: 200 })
    projects.dataset.scrollable = ""
    const project = document.createElement("button")
    projects.append(project)
    viewport.append(projects)
    expect(blocks(project, viewport)).toBe(false)
    projects.scrollTop = 100
    expect(blocks(project, viewport)).toBe(true)
  })

  test("blocks an interactive row when its nested viewport does not overflow", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    viewport.dataset.scrollable = ""
    const projects = dimensions(document.createElement("div"), { height: 100, content: 100 })
    projects.dataset.scrollable = ""
    const project = document.createElement("button")
    projects.append(project)
    viewport.append(projects)
    expect(blocks(project, viewport)).toBe(true)
  })

  test("contains open search and overlay wheel movement at nested boundaries", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    viewport.dataset.scrollable = ""
    const search = document.createElement("div")
    search.dataset.component = "home-session-search"
    search.dataset.open = ""
    const results = dimensions(document.createElement("div"), { top: 20, height: 100, content: 200 })
    results.dataset.scrollable = ""
    const result = document.createElement("button")
    results.append(result)
    search.append(results)
    viewport.append(search)
    expect(blocks(result, viewport)).toBe(false)
    results.scrollTop = 100
    expect(blocks(result, viewport)).toBe(true)

    const menu = document.createElement("div")
    menu.dataset.component = "menu-v2-content"
    expect(blocks(menu, viewport)).toBe(true)
  })

  test("ignores zoom gestures and already handled events", () => {
    const viewport = dimensions(document.createElement("div"), { height: 100, content: 300 })
    const target = document.createElement("button")
    const base = { target, viewport, deltaY: 40 }
    expect(shouldBlockHomeWheel({ ...base, ctrlKey: true, defaultPrevented: false })).toBe(false)
    expect(shouldBlockHomeWheel({ ...base, ctrlKey: false, defaultPrevented: true })).toBe(false)
  })
})
