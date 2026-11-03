import { useWorkspaceLocation } from "@/workspaces/location"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { SessionStepFailed } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { useSessionLayout } from "./session-layout"
import { useDialog, useI18n } from "@opencode/ui/context"
import { DialogUsageExceeded } from "@/providers/connect/usage-exceeded"
import { GoUpsellHero } from "@/providers/connect/go-upsell-hero"
import { useLocal, type ModelSelection } from "@/providers/models/selection"

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"

const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"

const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs

const GO_URL = "https://opencode.ai/go"

const MAX_RETRY_AFTER_MS = 7 * 86_400_000

const CHATGPT_USAGE_LIMIT_WINDOW = 86_400_000 // 24 hrs

export function formatLimitReset(locale: string, created: number, retryAfterMs: number | undefined) {
  if (
    retryAfterMs === undefined ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > MAX_RETRY_AFTER_MS ||
    !Number.isFinite(created)
  )
    return undefined

  const at = created + retryAfterMs

  if (Number.isNaN(new Date(at).getTime())) return undefined

  const now = Date.now()
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString() && at - now < GO_UPSELL_WINDOW

  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at)
}

export const GoUpsellState = Persistence.struct({
  [GO_UPSELL_FREE_TIER_LAST_SEEN_AT]: Schema.NullOr(Schema.Finite),
  [GO_UPSELL_FREE_TIER_DONT_SHOW]: Schema.NullOr(Schema.Finite),
})

export function useUsageExceededDialogs(input?: {
  selection?: () => ModelSelection | undefined
  onDone?: () => void
}) {
  const sdk = useWorkspaceLocation()
  const dialog = useDialog()
  const local = useLocal()
  const { params } = useSessionLayout()
  const { t, locale } = useI18n()

  const [goUpsellState, setGoUpsellState, goUpsellInit, goUpsellReady] = persisted(
    Persist.global("go-upsell"),
    GoUpsellState,
    {
      [GO_UPSELL_FREE_TIER_LAST_SEEN_AT]: null,
      [GO_UPSELL_FREE_TIER_DONT_SHOW]: null,
    },
  )

  const [chatgptUsageLimit, setChatGPTUsageLimit] = persisted(
    Persist.global("chatgpt-usage-limit"),
    Persistence.struct({ lastSeenAt: Schema.NullOr(Schema.Finite) }),
    { lastSeenAt: null },
  )

  const showFreeLimitDialog = (evt: SessionStepFailed) => {
    if (evt.data.sessionID !== params.id || dialog.active) return
    const seen = goUpsellState[GO_UPSELL_FREE_TIER_LAST_SEEN_AT]

    if (seen && Date.now() - seen < GO_UPSELL_WINDOW) return

    if (goUpsellState[GO_UPSELL_FREE_TIER_DONT_SHOW]) return

    // Counted when shown, so dismissing with Escape or the backdrop also waits out the window.
    setGoUpsellState(GO_UPSELL_FREE_TIER_LAST_SEEN_AT, Date.now())

    const reset = formatLimitReset(locale(), evt.created, evt.data.error.retryAfterMs)

    dialog.show(() => (
      <DialogUsageExceeded
        title={t("dialog.usageExceeded.freeTier.title")}
        description={
          reset
            ? `${t("dialog.usageExceeded.freeTier.description")} ${t("dialog.usageExceeded.freeTier.reset", { time: reset })}`
            : t("dialog.usageExceeded.freeTier.description")
        }
        actionLabel={t("dialog.usageExceeded.freeTier.actionLabel")}
        link={GO_URL}
        hero={<GoUpsellHero />}
        onClose={(dontShowAgain) => {
          if (dontShowAgain) setGoUpsellState(GO_UPSELL_FREE_TIER_DONT_SHOW, Date.now())
          else {
            void import("@/providers/connect/dialog").then((x) => {
              const controller = x.useProviderConnectController()
              controller.select("opencode-go")
              void dialog.show(() => (
                <x.DialogConnectProvider
                  directory={sdk().directory}
                  controller={controller}
                  standalone
                  selection={input?.selection?.() ?? local.model}
                  onDone={input?.onDone}
                />
              ))
            })
          }
        }}
      />
    ))
  }

  const whenGoUpsellReady = (show: (evt: SessionStepFailed) => void, evt: SessionStepFailed) => {
    if (goUpsellReady()) show(evt)
    else if (goUpsellInit instanceof Promise) void goUpsellInit.then(() => show(evt))
  }

  onCleanup(
    sdk().event.on("session.step.failed", (evt) => {
      if (evt.data.sessionID !== params.id || dialog.active) return
      const error = evt.data.error

      if (error.type === "provider.free-limit") return whenGoUpsellReady(showFreeLimitDialog, evt)

      if (error.type !== "provider.chatgpt-limit") return

      if (chatgptUsageLimit.lastSeenAt && Date.now() - chatgptUsageLimit.lastSeenAt < CHATGPT_USAGE_LIMIT_WINDOW) return

      void import("@/providers/connect/chatgpt-usage-limit").then((usage) => {
        if (dialog.active) return
        setChatGPTUsageLimit("lastSeenAt", Date.now())
        dialog.show(() => <usage.DialogChatGPTUsageLimit />)
      })
    }),
  )
}
