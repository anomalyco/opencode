import { For, Show, onCleanup, onMount } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/client/promise"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  let container: HTMLDivElement | undefined

  // Number-key shortcuts let keyboard and screen-reader users respond without
  // arrow-key navigation. Keys are handled on the focused dock so typing in
  // other surfaces never triggers a decision.
  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if (props.responding || !container?.contains(event.target as Node)) return
      const responses: Record<string, "once" | "always" | "reject"> = { "1": "once", "2": "always", "3": "reject" }
      const response = responses[event.key]
      if (response) props.onDecide(response)
    }
    window.addEventListener("keydown", handler)
    onCleanup(() => window.removeEventListener("keydown", handler))
  })

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.action}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      ref={(el) => {
        container = el
        queueMicrotask(() => el.focus())
      }}
      onKeyDown={(event) => container?.contains(event.target as Node) && event.stopPropagation()}
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
            <Button
              variant="ghost"
              size="normal"
              onClick={() => props.onDecide("reject")}
              disabled={props.responding}
              title="Shortcut: 3"
            >
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="neutral"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
              title="Shortcut: 2"
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button
              variant="contrast"
              size="normal"
              onClick={() => props.onDecide("once")}
              disabled={props.responding}
              title="Shortcut: 1"
            >
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

      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.resources}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
