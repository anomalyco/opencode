import { afterEach, describe, expect, test } from "bun:test"
import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { createComponent, createSignal } from "solid-js"
import { render } from "solid-js/web"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("dropdown lifecycle used by MenuV2", () => {
  let dispose: (() => void) | undefined
  let host: HTMLDivElement | undefined
  let outside: HTMLButtonElement | undefined

  afterEach(() => {
    dispose?.()
    host?.remove()
    outside?.remove()
    dispose = undefined
    host = undefined
    outside = undefined
  })

  test("keeps ARIA state reactive and dismisses exactly once per outside interaction", async () => {
    host = document.createElement("div")
    outside = document.createElement("button")
    document.body.append(host, outside)

    const [open, setOpen] = createSignal(false)
    const [subOpen, setSubOpen] = createSignal(false)
    const changes: boolean[] = []

    dispose = render(
      () =>
        createComponent(DropdownMenu, {
          get open() {
            return open()
          },
          onOpenChange(value) {
            changes.push(value)
            setOpen(value)
          },
          get children() {
            return [
              createComponent(DropdownMenu.Trigger, { children: "Open" }),
              createComponent(DropdownMenu.Portal, {
                get children() {
                  return createComponent(DropdownMenu.Content, {
                    get children() {
                      return createComponent(DropdownMenu.Sub, {
                        get open() {
                          return subOpen()
                        },
                        onOpenChange: setSubOpen,
                        get children() {
                          return [
                            createComponent(DropdownMenu.SubTrigger, { children: "More" }),
                            createComponent(DropdownMenu.Portal, {
                              get children() {
                                return createComponent(DropdownMenu.SubContent, {
                                  "data-testid": "submenu",
                                  get children() {
                                    return createComponent(DropdownMenu.Item, { children: "Nested item" })
                                  },
                                })
                              },
                            }),
                          ]
                        },
                      })
                    },
                  })
                },
              }),
            ]
          },
        }),
      host,
    )

    const trigger = host.querySelector("button")
    expect(trigger?.getAttribute("aria-haspopup")).toBe("true")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")

    setOpen(true)
    await tick()

    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    const subTrigger = document.querySelector<HTMLElement>("[role='menuitem'][aria-haspopup='true']")
    expect(subTrigger?.getAttribute("aria-expanded")).toBe("false")

    setSubOpen(true)
    await tick()

    expect(subTrigger?.getAttribute("aria-expanded")).toBe("true")
    expect(document.querySelector("[data-testid='submenu']")?.getAttribute("role")).toBe("menu")

    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
    await tick()

    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(changes).toEqual([false])

    setOpen(true)
    await tick()
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
    await tick()

    expect(changes).toEqual([false, false])

    dispose()
    dispose = undefined
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
    await tick()

    expect(changes).toEqual([false, false])
  })
})
