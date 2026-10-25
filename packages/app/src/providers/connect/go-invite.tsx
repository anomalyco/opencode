import { Button } from "@opencode/ui/button"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { LOGO, LOGO_COLS, LOGO_ROWS } from "./go-upsell-hero-art"
import "./go-invite.css"

const PITCH = 3

const DOT = 2.5

function GoCells(props: { class: string }) {
  return (
    <svg
      class={props.class}
      viewBox={`0 0 ${LOGO_COLS * PITCH} ${LOGO_ROWS * PITCH}`}
      width={LOGO_COLS * PITCH}
      height={LOGO_ROWS * PITCH}
      aria-hidden="true"
    >
      <For each={LOGO}>
        {(cell) => <rect x={cell.col * PITCH} y={cell.row * PITCH} width={DOT} height={DOT} data-kind={cell.kind} />}
      </For>
    </svg>
  )
}

/** Invites a signed-in Console account without a Go subscription to add one. */
export function GoInviteCard(props: { onSubscribe: () => void }) {
  const language = useLanguage()

  return (
    <div data-component="go-invite" class="flex shrink-0 items-center gap-3 rounded-lg p-2 pr-3">
      <div data-slot="go-invite-mark" class="relative flex h-11 w-[72px] shrink-0 items-center justify-center rounded">
        <GoCells class="go-invite-cells" />
        <GoCells class="go-invite-shimmer absolute" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] leading-5">
          <span class="font-[530] text-v2-text-text-base">{language.t("provider.connect.goInvite.title")}</span>
          <span class="ms-1.5 tabular-nums text-v2-text-text-muted">
            {language.t("provider.connect.goInvite.price")}
          </span>
        </p>
        <p class="text-[13px] leading-5 text-v2-text-text-muted [text-wrap:balance]">
          {language.t("provider.connect.goInvite.noSubscription")} {language.t("provider.connect.goInvite.models")}
        </p>
      </div>
      <Button variant="neutral" class="shrink-0" onClick={() => props.onSubscribe()}>
        {language.t("provider.connect.models.subscribe")}
      </Button>
    </div>
  )
}
