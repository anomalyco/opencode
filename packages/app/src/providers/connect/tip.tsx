import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Schema } from "effect"
import { createMemo, createSignal, Show, type Accessor } from "solid-js"
import { useProviders } from "@/providers/catalog/providers"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { createPresence } from "@/runtime/presence"

const dismissalDuration = 30 * 24 * 60 * 60 * 1000

export const ProviderTipSchema = Persistence.struct({
  dismissedAt: Schema.Finite,
})

// Undefined directory reads the server's default Location.
export function createProviderTip(directory: Accessor<string | undefined>) {
  const providers = useProviders(directory)

  const [state, setState, , ready] = persisted(Persist.global("new-session.provider-tip"), ProviderTipSchema, {
    dismissedAt: 0,
  })

  return {
    directory,
    visible: createMemo(
      () => ready() && providers.anyConnection() === false && Date.now() - state.dismissedAt >= dismissalDuration,
    ),
    dismiss: () => setState("dismissedAt", Date.now()),
  }
}

export function ProviderTip(props: {
  tip: ReturnType<typeof createProviderTip>
  selection?: ModelSelection
  onDone?: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<HTMLDivElement>()

  const presence = createPresence({
    show: props.tip.visible,
    element: () => ref() ?? null,
  })

  const open = () => {
    if (!props.tip.visible()) return
    const directory = props.tip.directory()

    void import("@/providers/connect/dialog").then(({ DialogConnectProvider }) => {
      void dialog.show(() => (
        <DialogConnectProvider
          directory={directory}
          defaultLocation={directory === undefined}
          selection={props.selection}
          onDone={props.onDone}
        />
      ))
    })
  }

  const dismiss = () => {
    if (!props.tip.visible()) return
    props.tip.dismiss()
  }

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="new-session-tip"
          data-visible={props.tip.visible()}
          class="group/new-session-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{ "data-[visible=false]:animate-out fade-out slide-out-to-bottom-4": true }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-[4px] pl-1.5 text-[13px] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-none"
            onClick={open}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <Icon name="chevron-down" class="-rotate-90" />
            </span>
          </button>
          <Tooltip
            class="hover-reveal absolute left-full top-0 flex h-6 w-7 items-center justify-end delay-0 duration-0 group-hover/new-session-tip:delay-[250ms] group-hover/new-session-tip:duration-150 group-hover/new-session-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
            placement="top"
            openDelay={800}
            value={language.t("common.dismiss")}
          >
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[4px] text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
              aria-label={language.t("common.dismiss")}
              onClick={dismiss}
            >
              <Icon name="close" />
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  )
}
