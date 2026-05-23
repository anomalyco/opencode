import { For, Show, onCleanup, onMount } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  let root: HTMLDivElement | undefined

  const measure = () => {
    if (!root) return

    const scroller = document.querySelector(".scroll-view__viewport")
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined
    const top =
      head instanceof HTMLElement && head.classList.contains("sticky") ? head.getBoundingClientRect().bottom : 0
    if (!top) {
      root.style.removeProperty("--permission-prompt-max-height")
      return
    }

    const dock = root.closest('[data-component="session-prompt-dock"]')
    if (!(dock instanceof HTMLElement)) return

    const dockBottom = dock.getBoundingClientRect().bottom
    const below = Math.max(0, dockBottom - root.getBoundingClientRect().bottom)
    const gap = 8
    const max = Math.max(240, Math.floor(dockBottom - top - gap - below))
    root.style.setProperty("--permission-prompt-max-height", `${max}px`)
  }

  onMount(() => {
    let raf: number | undefined
    const update = () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = undefined
        measure()
      })
    }

    update()

    makeEventListener(window, "resize", update)

    const dock = root?.closest('[data-component="session-prompt-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
    createResizeObserver([dock, scroller], update)

    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })
  })

  return (
    <DockPrompt
      kind="permission"
      ref={(el) => (root = el)}
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
