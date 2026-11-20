import { createSignal, onCleanup, Show } from "solid-js"
import { Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ModelSelection } from "@/providers/models/selection"
import { limitResetAt } from "../usage-exceeded-dialogs"

const GO_URL = "https://opencode.ai/go"

// OpenCode Zen always says when free usage resets; this covers a refusal that doesn't, or a delay out of range.
const FALLBACK_RESET_MS = 3_600_000

const FreeLimitState = Persistence.struct({ resetAt: Schema.NullOr(Schema.Finite) })

// Free usage is counted per network, not per session, so one refusal anywhere holds until it resets. Connecting a paid
// provider ends it early.
export function useFreeLimit(paid: () => boolean) {
  const location = useWorkspaceLocation()
  const [state, setState] = persisted(Persist.global("free-limit"), FreeLimitState, { resetAt: null })
  const [now, setNow] = createSignal(Date.now())

  onCleanup(
    location().event.on("session.step.failed", (event) => {
      if (event.data.error.type !== "provider.free-limit") return
      setState(
        "resetAt",
        limitResetAt(event.created, event.data.error.retryAfterMs) ?? event.created + FALLBACK_RESET_MS,
      )
    }),
  )

  const resetAt = () => state.resetAt

  // Re-check when the limit resets, so the composer comes back on its own.
  const timer = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(timer))

  return {
    resetAt,
    active: () => {
      const at = resetAt()

      return !paid() && at !== null && at > now()
    },
  }
}

// Stands in for the composer while free usage is used up: with no paid provider there is nothing the composer can send.
export function SessionFreeLimitPanel(props: { resetAt: number | null; selection: () => ModelSelection | undefined }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const location = useWorkspaceLocation()

  const reset = () => {
    const at = props.resetAt

    if (at === null) return
    const sameDay = new Date(at).toDateString() === new Date().toDateString()

    return new Intl.DateTimeFormat(
      language.locale(),
      sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
    ).format(at)
  }

  const connect = (provider?: string) => {
    void import("@/providers/connect/dialog").then((x) => {
      const controller = x.useProviderConnectController()

      if (provider) controller.select(provider)
      void dialog.show(() => (
        <x.DialogConnectProvider
          controller={controller}
          directory={location().directory}
          selection={props.selection()}
          standalone={!!provider}
        />
      ))
    })
  }

  const subscribe = () => {
    platform.openExternal(GO_URL)
    connect("opencode-go")
  }

  return (
    <div
      data-component="session-free-limit"
      role="status"
      class="flex flex-col gap-4 rounded-xl bg-v2-background-bg-base p-2 [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-raised)] [font-family:var(--v2-font-family-sans)]"
    >
      <div class="flex flex-col gap-0.5 ps-1.5 pe-1 pt-1">
        <div class="text-[13px] font-[530] leading-[var(--line-height-base)] text-v2-text-text-base">
          {language.t("session.freeLimit.title")}
        </div>
        <div class="text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted [font-variant-numeric:tabular-nums]">
          <Show when={reset()} fallback={language.t("session.freeLimit.noReset")}>
            {(time) => language.t("session.freeLimit.reset", { time: time() })}
          </Show>
        </div>
      </div>
      <div class="flex items-center justify-end gap-1.5">
        <Button
          data-action="session-free-limit-subscribe"
          type="button"
          size="normal"
          variant="ghost"
          class="![font-weight:530]"
          onClick={subscribe}
        >
          {language.t("session.freeLimit.subscribe")}
        </Button>
        <Button
          data-action="session-free-limit-connect"
          type="button"
          size="normal"
          variant="submit"
          class="![font-weight:530]"
          onClick={() => connect()}
        >
          {language.t("session.freeLimit.connect")}
        </Button>
      </div>
    </div>
  )
}
