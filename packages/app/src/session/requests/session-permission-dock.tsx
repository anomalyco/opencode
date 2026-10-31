import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.action}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])

    if (value === key) return ""

    return value
  }

  const input = () => {
    const value = props.request.metadata?.input
    if (!value || typeof value !== "object") return []
    return Object.entries(value).map(
      ([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`,
    )
  }

  return (
    <DockPrompt
      kind="permission"
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
              variant="neutral"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="submit" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <Show when={toolDescription()} fallback={<code data-slot="permission-hint">{props.request.action}</code>}>
          <div data-slot="permission-hint">{toolDescription()}</div>
        </Show>
      </div>

      <Show when={props.request.message}>
        {(message) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-hint">{message()}</div>
          </div>
        )}
      </Show>

      <Show when={input().length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          {/* Scrolls rather than truncates: the user approves these arguments, so all of them must be reachable */}
          <div data-slot="permission-input" data-scrollable>
            <For each={input()}>{(line) => <code class="text-text-weak break-all">{line}</code>}</For>
          </div>
        </div>
      </Show>

      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.resources}>
              {(pattern) => <code class="text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
