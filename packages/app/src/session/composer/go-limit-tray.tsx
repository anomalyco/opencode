import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { SessionStepFailed } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { isFreeModel } from "@/providers/models/models"
import type { ModelSelection } from "@/providers/models/selection"
import { formatLimitReset, goLimitActive, goLimited, goLimitLink } from "../usage-exceeded-dialogs"
import { Grow } from "./spring-height"

// Go's usage window: limits refill over five hours.
const GO_WINDOW_MS = 5 * 3_600_000

type GoLimit = {
  /** When Go is back, if the server said. */
  goAt?: number
  /** Free models ran out too, after switching away from Go. */
  both: boolean
  freeAt?: number
  link: string
}

const resetAt = (event: SessionStepFailed) => {
  const ms = event.data.error.retryAfterMs

  return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? event.created + ms : undefined
}

// Pullout above the composer for a Go subscriber who hit their usage limit: when Go is back, and one click to keep
// going. It grows out from under the composer like the queue panel.
export function SessionGoLimitTray(props: { sessionID: string | undefined; selection: () => ModelSelection | undefined }) {
  const language = useLanguage()
  const platform = usePlatform()
  const location = useWorkspaceLocation()
  const [limit, setLimit] = createSignal<GoLimit>()
  const [open, setOpen] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())

  const timer = setInterval(() => setNow(Date.now()), 15_000)
  onCleanup(() => clearInterval(timer))

  onCleanup(
    location().event.on("session.step.failed", (event) => {
      if (!props.sessionID || event.data.sessionID !== props.sessionID) return
      const type = event.data.error.type

      if (type === "provider.go-limit") {
        const goAt = resetAt(event)
        goLimited.set(props.sessionID, goAt)
        setLimit({ goAt, both: false, link: goLimitLink(event.data.error) })
        setNow(Date.now())

        return setOpen(true)
      }

      if (type === "provider.free-limit" && goLimitActive(props.sessionID)) {
        setLimit((current) => ({
          goAt: current?.goAt ?? goLimited.get(props.sessionID!),
          link: current?.link ?? goLimitLink(event.data.error),
          both: true,
          freeAt: resetAt(event),
        }))
        setNow(Date.now())
        setOpen(true)
      }
    }),
  )

  const time = (at: number | undefined) => (at === undefined ? undefined : formatLimitReset(language.locale(), at, 0))

  const left = (at: number | undefined) => {
    if (at === undefined) return undefined
    const minutes = Math.max(1, Math.round((at - now()) / 60_000))
    const hours = Math.floor(minutes / 60)

    return hours > 0
      ? language.t("session.goLimit.inHours", { hours, minutes: minutes % 60 })
      : language.t("session.goLimit.inMinutes", { minutes })
  }

  // How much of Go's window is still to wait: the ring empties as the reset gets closer.
  const remaining = createMemo(() => {
    const at = limit()?.goAt

    return at === undefined ? 1 : Math.max(0, Math.min(1, (at - now()) / GO_WINDOW_MS))
  })

  const text = createMemo(() => {
    const current = limit()

    if (!current) return { title: "", detail: "" }
    const go = time(current.goAt)
    const free = time(current.freeAt)

    if (current.both) {
      const detail = () => {
        if (go && free) return language.t("session.goLimit.both.detail", { go, free })

        if (go) return language.t("session.goLimit.both.detailGo", { go })

        return ""
      }

      return { title: language.t("session.goLimit.both.title"), detail: detail() }
    }

    return {
      title: language.t("session.goLimit.title"),
      detail: go ? language.t("session.goLimit.detail", { time: go, left: left(current.goAt) ?? "" }) : "",
    }
  })

  const both = () => limit()?.both === true

  const freeModel = () => props.selection()?.list().find(isFreeModel)

  const switchToFree = () => {
    const selection = props.selection()
    const model = freeModel()

    if (!selection || !model) return
    selection.set({ providerID: model.provider.id, modelID: model.id }, { recent: true })
    setOpen(false)
  }

  const useCredits = () => {
    const current = limit()

    if (current) platform.openExternal(current.link)
  }

  return (
    <Grow when={open() && limit()} fade class="relative z-0">
      <div
        data-component="session-go-limit-tray"
        data-state={both() ? "both" : "go"}
        role="status"
        class="relative z-0 -mb-3 flex items-center gap-2.5 rounded-xl bg-v2-background-bg-base ps-3 pe-1.5 pt-1.5 pb-[18px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
      >
        <svg class="size-4 shrink-0 -rotate-90" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke-width="2" class="stroke-v2-border-border-base" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            pathLength="100"
            stroke-dasharray={`${(remaining() * 100).toFixed(1)} 100`}
            class="stroke-v2-text-text-muted"
          />
        </svg>
        <div class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-variant-numeric:tabular-nums]">
          <span class="font-[530] text-v2-text-text-base">{text().title}</span>
          <Show when={text().detail}> {text().detail}</Show>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            data-action="session-go-limit-credits"
            type="button"
            size="small"
            variant={both() ? "contrast" : "ghost-faint"}
            class="![font-weight:530]"
            onClick={useCredits}
          >
            {language.t("session.goLimit.useCredits")}
          </Button>
          <Show when={!both() && freeModel()}>
            <Button
              data-action="session-go-limit-free"
              type="button"
              size="small"
              variant="contrast"
              class="![font-weight:530]"
              onClick={switchToFree}
            >
              {language.t("session.goLimit.switchFree")}
            </Button>
          </Show>
          <IconButton
            data-action="session-go-limit-dismiss"
            type="button"
            size="small"
            variant="ghost-muted"
            icon={<Icon name="outline-xmark" />}
            aria-label={language.t("common.dismiss")}
            onClick={() => setOpen(false)}
          />
        </div>
      </div>
    </Grow>
  )
}
