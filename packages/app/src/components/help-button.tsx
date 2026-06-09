import { Icon } from "@opencode-ai/ui/v2/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"

export function HelpButton() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  const [state, setState] = /* persisted(Persist.global("help-button"), */ createStore({ dismissed: false }) /* ) */
  const [shown, setShown] = createSignal(false)

  return (
    <Show when={!state.dismissed}>
      <div class="fixed bottom-4 right-4 z-50">
        <Popover
          open={shown()}
          onOpenChange={setShown}
          triggerAs="button"
          triggerProps={{
            type: "button",
            "aria-label": "Help",
            class:
              "size-7 rounded-full bg-background-base shadow-[var(--shadow-lg-border-base)] flex items-center justify-center text-text-base hover:text-text-strong transition-colors",
          }}
          trigger={<span aria-hidden="true">?</span>}
          class="[&_[data-slot=popover-body]]:p-0 w-[320px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
          gutter={8}
          placement="top-end"
        >
          <Show when={shown()}>
            <div class="relative flex flex-col gap-1 w-[320px] p-4 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]">
              <button
                type="button"
                aria-label="Close"
                class="absolute top-3.5 right-3.5 size-6 rounded-md flex items-center justify-center text-text-base hover:text-text-strong hover:bg-surface-raised-base-hover transition-colors"
                onClick={() => {
                  setShown(false)
                  setState("dismissed", true)
                }}
              >
                <Icon name="xmark-small" />
              </button>
              <span class="text-14-regular text-text-strong">Lorem ipsum dolor sit amet</span>
              <p class="text-12-regular text-text-weak">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et
                dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.
              </p>
            </div>
          </Show>
        </Popover>
      </div>
    </Show>
  )
}
