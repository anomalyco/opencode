import { Show, type Accessor } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"

type PennylaneHealth = {
  healthy: boolean
  configured: boolean
  code: string
  message?: string
}

function IntegrationsIcon(props: { class?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      width="16"
      height="16"
    >
      {/* Two connected nodes — represents integrations/connections */}
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" stroke-width="1.25" />
      <circle cx="14" cy="14" r="2.5" stroke="currentColor" stroke-width="1.25" />
      <path d="M8 8L12 12" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" />
      <circle cx="14" cy="6" r="2.5" stroke="currentColor" stroke-width="1.25" />
      <path d="M12 8L14 11.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" opacity="0.4" />
    </svg>
  )
}

function PennylaneLogo(props: { class?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      <circle cx="100" cy="100" r="88" stroke="#3C5068" stroke-width="24" fill="none" />
      <circle cx="82" cy="100" r="36" fill="#2CED71" />
      <circle cx="118" cy="100" r="36" fill="#0A7B5A" />
      <path
        d="M100 70.72C107.55 77.02 112.36 86.42 112.36 97C112.36 107.58 107.55 116.98 100 123.28C92.45 116.98 87.64 107.58 87.64 97C87.64 86.42 92.45 77.02 100 70.72Z"
        fill="#0A7B5A"
        opacity="0.6"
      />
    </svg>
  )
}

export function IntegrationsPopover(props: {
  pennylaneHealth: Accessor<PennylaneHealth | undefined>
  pennylaneHealthy: Accessor<boolean>
  pennylaneConfigured: Accessor<boolean>
}) {
  const language = useLanguage()

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class:
          "rounded-md h-[24px] px-2.5 gap-1.5 border border-border-base bg-surface-panel shadow-none data-[expanded]:bg-surface-raised-base-active",
        style: { scale: 1 },
      }}
      trigger={
        <div class="flex items-center gap-1.5">
          <IntegrationsIcon class="text-icon-base" />
          <span class="text-12-regular text-text-strong">Integrations</span>
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[300px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={6}
      placement="bottom-end"
    >
      <div class="w-[300px] rounded-xl shadow-[var(--shadow-lg-border-base)] bg-background-strong overflow-hidden">
        <div class="px-4 pt-3 pb-2">
          <div class="text-13-medium text-text-strong">Integrations</div>
        </div>

        <div class="px-2 pb-2">
          <div class="flex flex-col bg-background-base rounded-sm">
            {/* Pennylane */}
            <div class="flex items-center gap-3 px-3 py-2.5">
              <PennylaneLogo class="size-5 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-13-medium text-text-strong">Pennylane</div>
              </div>
              <div class="flex items-center gap-1.5">
                <div
                  classList={{
                    "size-1.5 rounded-full shrink-0": true,
                    "bg-icon-success-base": props.pennylaneHealthy(),
                    "bg-icon-critical-base": props.pennylaneConfigured() && !props.pennylaneHealthy(),
                    "bg-border-weak-base": !props.pennylaneConfigured(),
                  }}
                />
                <span class="text-12-regular text-text-dimmed">
                  {props.pennylaneHealthy()
                    ? language.t("status.pennylane.connected")
                    : props.pennylaneConfigured()
                      ? language.t("status.pennylane.disconnected")
                      : language.t("status.pennylane.notConfigured")}
                </span>
              </div>
            </div>

            <Show when={props.pennylaneConfigured() && !props.pennylaneHealthy() && props.pennylaneHealth()?.message}>
              <div class="px-3 pb-2.5 -mt-1">
                <div class="text-11-regular text-text-weak">{props.pennylaneHealth()?.message}</div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Popover>
  )
}
