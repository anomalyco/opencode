import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { installNavMenus } from "../src/index"

let stop: () => void

beforeEach(() => {
  document.body.innerHTML = `
    <header>
      <a href="/" data-nav-logo aria-label="OpenCode home" aria-haspopup="menu" aria-expanded="false"><svg width="20" height="25"></svg></a>
      <a href="/data" data-nav-name>Data</a>
    </header>
    <main><a href="#elsewhere">Elsewhere</a></main>`
  stop = installNavMenus({ link: (path) => `https://example.test${path}` })
})

afterEach(() => stop())

const logo = () => document.querySelector<HTMLElement>("[data-nav-logo]")!
const name = () => document.querySelector<HTMLElement>("[data-nav-name]")!
const menus = () => [...document.querySelectorAll<HTMLElement>("[data-nav-menu]:not([data-closing])")]
const items = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')]
const press = (target: HTMLElement, key: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }))

describe("logo menu", () => {
  test("opens from a right-click on the logo instead of the browser's menu, with the brand files and links", () => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 30,
      clientY: 30,
    })

    logo().dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    const menu = menus()[0]!
    expect(menu.getAttribute("data-nav-menu")).toBe("logo")
    expect(
      items(menu)
        .slice(8)
        .map((item) => item.getAttribute("href")),
    ).toEqual([
      "https://example.test/files/site/2026-11/opencode-brand-assets.zip",
      "https://example.test/brand",
      "https://example.test/press",
    ])
    expect(items(menu)[0]!.getAttribute("download")).toBe("opencode-logo-transparent-light.svg")
    expect(items(menu)[0]!.querySelector("svg")).not.toBeNull()
  })

  test("a long press opens it, and the next tap follows the logo even when the press sent no click", async () => {
    const touch = () =>
      logo().dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 10, clientY: 10 }),
      )

    touch()
    await Bun.sleep(550)
    expect(menus()[0]?.getAttribute("data-nav-menu")).toBe("logo")

    touch()
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true })
    logo().dispatchEvent(tap)

    expect(tap.defaultPrevented).toBe(false)
  })

  test("Shift+F10 opens it on its first card, and Escape returns to the logo", () => {
    logo().focus()

    press(logo(), "F10", true)
    expect(document.activeElement?.textContent).toBe("Logo · Light SVG")
    press(document.activeElement as HTMLElement, "Escape")

    expect(menus()).toHaveLength(0)
    expect(document.activeElement).toBe(logo())
  })
})

describe("product name", () => {
  test("stays a plain link with no hover dropdown or touch toggle", async () => {
    expect(document.querySelector("[data-nav-product-toggle]")).toBeNull()

    name().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }))
    await Bun.sleep(200)
    press(name(), "ArrowDown")

    expect(menus()).toHaveLength(0)
  })
})

describe("closing", () => {
  test("a click elsewhere on the page closes it", () => {
    press(logo(), "ContextMenu")

    document.querySelector("main a")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))

    expect(menus()).toHaveLength(0)
  })

  test("focus moving elsewhere, such as into the host's search, closes it", () => {
    press(logo(), "ContextMenu")

    document.querySelector<HTMLElement>("main a")!.focus()

    expect(menus()).toHaveLength(0)
  })

  test("tells the host when it opens, so it can close its own menus", () => {
    const opened: string[] = []
    document.addEventListener("opencode-nav-menu-open", () => opened.push("open"), { once: true })

    press(logo(), "ContextMenu")

    expect(opened).toEqual(["open"])
  })
})
