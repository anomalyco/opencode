import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useLanguage } from "@/runtime/i18n/language"
import { Show } from "solid-js"
import type { ServerHealth } from "@/runtime/server/health"

export function ServerHealthIndicator(props: {
  health?: ServerHealth
  connecting?: boolean
  authenticationRequired?: boolean
}) {
  const language = useLanguage()

  return (
    <Show
      when={props.authenticationRequired}
      fallback={
        <Show
          when={props.connecting || props.health?.checking}
          fallback={
            <Show
              when={props.health?.incompatible}
              fallback={
                <div
                  classList={{
                    "size-1.5 rounded-full shrink-0 my-[3.5px]": true,
                    "bg-icon-success-base": props.health?.healthy === true,
                    "bg-icon-critical-base": props.health?.healthy === false,
                    "bg-v2-icon-icon-faint": props.health === undefined,
                  }}
                />
              }
            >
              <Icon name="warning" size="small" class="shrink-0 text-icon-warning-base" />
            </Show>
          }
        >
          <span
            role="status"
            aria-label={language.t("server.status.connecting")}
            class="inline-flex h-3.5 w-1.5 shrink-0 items-center justify-center text-v2-icon-icon-muted"
          >
            <Loader class="size-3 shrink-0" />
          </span>
        </Show>
      }
    >
      <span
        role="status"
        aria-label={language.t("server.status.authentication")}
        class="inline-flex h-3.5 w-1.5 shrink-0 items-center justify-center text-v2-icon-icon-muted"
      >
        <Icon name="lock" size="small" class="shrink-0" />
      </span>
    </Show>
  )
}
