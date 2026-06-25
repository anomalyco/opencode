import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import type { VoiceDisplayState } from "./voice"
import { voiceStatusKey } from "./voice"

function MicIcon(props: { active: boolean; class?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      aria-hidden="true"
    >
      <rect
        x="7.5"
        y="3.75"
        width="5"
        height="8.75"
        rx="2.5"
        stroke="currentColor"
        stroke-width="1.25"
        fill={props.active ? "currentColor" : "none"}
        fill-opacity={props.active ? "0.15" : "0"}
      />
      <path
        d="M4.583 10a5.417 5.417 0 0 0 10.834 0M10 15.417V17.5"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function PromptVoiceComposer(props: {
  display: () => VoiceDisplayState
  statusHeader?: () => string | undefined
  hearingText?: () => string
  showDisclosure: () => boolean
  onToggle: () => void
  onDismissDisclosure: () => void
  t: (key: string, values?: Record<string, string>) => string
  design?: boolean
}) {
  const label = () => {
    const state = props.display()
    if (state === "off") return props.t("prompt.voice.action.turnOn")
    return props.t("prompt.voice.action.turnOff")
  }

  const status = () => {
    const header = props.statusHeader?.()
    if (header) return props.t("prompt.voice.status.awaitingQuestionNamed", { header })
    const heard = props.hearingText?.()?.trim()
    if (props.display() === "hearing" && heard) return heard
    return props.t(voiceStatusKey(props.display()))
  }

  return (
    <div
      data-component="prompt-voice"
      class="pointer-events-auto flex min-w-0 items-center gap-2"
      classList={{
        "text-v2-text-text-faint": props.design,
        "text-text-weak": !props.design,
      }}
    >
      <Show when={props.showDisclosure()}>
        <div
          class="flex min-w-0 max-w-[min(100%,20rem)] items-center gap-2 rounded-md border border-border-base bg-surface-raised-base px-2 py-1 text-12-regular text-text-base shadow-xs"
          classList={{
            "border-v2-border-border-base bg-v2-background-bg-base text-v2-text-text-base text-[11px] leading-4":
              props.design,
          }}
        >
          <span class="min-w-0 flex-1">{props.t("prompt.voice.disclosure")}</span>
          <Button
            type="button"
            variant="ghost"
            class="h-6 shrink-0 px-2 text-12-regular"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              props.onDismissDisclosure()
            }}
          >
            {props.t("prompt.voice.disclosure.dismiss")}
          </Button>
        </div>
      </Show>

      <Show when={props.display() !== "off"}>
        <span
          data-slot="voice-status"
          class="max-w-[min(100%,20rem)] truncate text-12-regular tabular-nums"
          classList={{
            "text-v2-text-text-base text-[11px] font-[440] leading-4 animate-pulse":
              props.design && (props.display() === "hearing" || props.display() === "speaking"),
            "animate-pulse": !props.design && (props.display() === "hearing" || props.display() === "speaking"),
          }}
        >
          {status()}
        </span>
      </Show>

      <Button
        type="button"
        data-action="prompt-voice"
        variant="ghost"
        class="size-8 shrink-0 p-0"
        classList={{
          "text-icon-info-active": props.display() !== "off",
          "opacity-70 hover:opacity-100": props.display() === "off",
        }}
        aria-pressed={props.display() !== "off"}
        aria-label={label()}
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          props.onToggle()
        }}
      >
        <MicIcon active={props.display() !== "off"} />
      </Button>
    </div>
  )
}
