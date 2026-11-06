import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useLanguage } from "@/runtime/i18n/language"
import { Match, Switch } from "solid-js"
import { selectServerIndicator, type ServerHealth } from "@/runtime/server/health-machine"

export function ServerHealthIndicator(props: { health?: ServerHealth }) {
  const language = useLanguage()
  const indicator = () => selectServerIndicator(props.health)

  return (
    <Switch
      fallback={
        <div
          classList={{
            "size-1.5 rounded-full shrink-0 my-[3.5px]": true,
            "bg-icon-success-base": indicator() === "healthy",
            "bg-icon-critical-base": indicator() === "unreachable",
            "bg-v2-icon-icon-faint": indicator() === "unknown",
          }}
        />
      }
    >
      <Match when={indicator() === "auth"}>
        <span
          role="status"
          aria-label={language.t("server.status.authentication")}
          class="inline-flex h-3.5 w-1.5 shrink-0 items-center justify-center text-v2-icon-icon-muted"
        >
          <Icon name="lock" size="small" class="shrink-0" />
        </span>
      </Match>
      <Match when={indicator() === "connecting"}>
        <span
          role="status"
          aria-label={language.t("server.status.connecting")}
          class="inline-flex h-3.5 w-1.5 shrink-0 items-center justify-center text-v2-icon-icon-muted"
        >
          <Loader class="size-3 shrink-0" />
        </span>
      </Match>
      <Match when={indicator() === "incompatible"}>
        <Icon name="warning" size="small" class="shrink-0 text-icon-warning-base" />
      </Match>
    </Switch>
  )
}
