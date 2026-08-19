import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { SessionStatus } from "@opencode-ai/sdk/v2"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSessionLayout } from "./session-layout"
import { useDialog } from "@opencode-ai/ui/context"
import { DialogUsageExceeded } from "@/components/dialog-usage-exceeded"
import { useI18n } from "@opencode-ai/ui/context"

const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs
const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])

function goUpsellKeys(status: SessionStatus) {
  if (status.type !== "retry" || !status.action) return
  const { action } = status
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT,
      dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW,
    } as const
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW,
    } as const
  }
}

export function useUsageExceededDialogs() {
  const sdk = useSDK()
  const dialog = useDialog()
  const { params } = useSessionLayout()
  const { tDynamic } = useI18n()

  const [goUpsellState, setGoUpsellState] = persisted(
    Persist.global("go-upsell"),
    createStore({
      [GO_UPSELL_FREE_TIER_LAST_SEEN_AT]: null as null | number,
      [GO_UPSELL_FREE_TIER_DONT_SHOW]: null as null | number,
      [GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT]: null as null | number,
      [GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW]: null as null | number,
    }),
  )

  onCleanup(
    sdk().event.on("session.status", (evt) => {
      if (evt.properties.sessionID !== params.id) return
      if (evt.properties.status.type !== "retry") return
      const { action } = evt.properties.status
      if (!action) return
      if (dialog.active) return

      const keys = goUpsellKeys(evt.properties.status)
      if (!keys) return

      const seen = goUpsellState[keys.lastSeenAt]
      if (seen && Date.now() - seen < GO_UPSELL_WINDOW) return
      if (goUpsellState[keys.dontShow]) return

      if (action.reason === "free_tier_limit") {
        dialog.show(() => (
          <DialogUsageExceeded
            title={tDynamic("dialog.usageExceeded.freeTier.title", action.title)}
            description={tDynamic("dialog.usageExceeded.freeTier.description", action.message)}
            actionLabel={tDynamic("dialog.usageExceeded.freeTier.actionLabel", action.label)}
            link={action.link}
            onClose={(dontShowAgain) => {
              setGoUpsellState(keys.lastSeenAt, Date.now())
              if (dontShowAgain) setGoUpsellState(keys.dontShow, Date.now())
              else {
                void import("../../components/dialog-connect-provider").then((x) => {
                  const controller = x.useProviderConnectController()
                  controller.select("opencode-go")
                  void dialog.show(() => <x.DialogConnectProvider controller={controller} />)
                })
              }
            }}
          />
        ))
      } else if (action.reason === "account_rate_limit") {
        dialog.show(() => (
          <DialogUsageExceeded
            title={tDynamic("dialog.usageExceeded.accountRateLimit.title", action.title)}
            description={tDynamic("dialog.usageExceeded.accountRateLimit.description", action.message)}
            actionLabel={tDynamic("dialog.usageExceeded.accountRateLimit.actionLabel", action.label)}
            link={action.link}
            onClose={(dontShowAgain) => {
              setGoUpsellState(keys.lastSeenAt, Date.now())
              if (dontShowAgain) setGoUpsellState(keys.dontShow, Date.now())
            }}
          />
        ))
      }
    }),
  )
}
