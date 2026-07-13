import { onCleanup, onMount } from "solid-js"

export function createBreadcrumbMenuRoot() {
  let root: HTMLElement | undefined

  onMount(() => {
    const closeMenus = (except?: HTMLDetailsElement) => {
      root?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        if (menu !== except) menu.open = false
      })
    }
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      root?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        if (!path.includes(menu)) menu.open = false
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const menu = root?.querySelector<HTMLDetailsElement>("details[open]")
      if (!menu) return
      event.preventDefault()
      menu.open = false
      menu.querySelector<HTMLElement>("summary")?.focus()
    }
    const onToggle = (event: Event) => {
      if (!(event.target instanceof HTMLDetailsElement) || !event.target.open) return
      closeMenus(event.target)
    }
    const onFocusOut = () => {
      queueMicrotask(() => {
        if (root?.contains(document.activeElement)) return
        closeMenus()
      })
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    root?.addEventListener("toggle", onToggle, true)
    root?.addEventListener("focusout", onFocusOut)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      root?.removeEventListener("toggle", onToggle, true)
      root?.removeEventListener("focusout", onFocusOut)
    })
  })

  return (element: HTMLElement) => {
    root = element
  }
}
