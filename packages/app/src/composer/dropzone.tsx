import { Icon } from "@opencode-ai/ui/icon"
import { Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { createAnimatedPresence } from "@/runtime/animated-presence"

export function ComposerDropzone(props: {
  active: boolean
  input?: { image?: boolean; pdf?: boolean }
  identity?: () => unknown
}) {
  const language = useLanguage()
  const [elements, setElements] = createStore<{ dropzone?: HTMLDivElement }>({})
  const label = createMemo(() => {
    if (!props.input?.image && !props.input?.pdf) return language.t("ui.promptInput.dropFiles")
    if (!props.input.pdf) return language.t("ui.promptInput.dropFiles.image")
    if (!props.input.image) return language.t("ui.promptInput.dropFiles.pdf")
    return language.t("ui.promptInput.dropFiles.imagePdf")
  })
  const presence = createAnimatedPresence(
    () => (props.active ? label() : undefined),
    () => elements.dropzone ?? null,
    props.identity,
  )

  return (
    <>
      <div
        data-slot="session-dropzone-blur"
        data-visible={props.active}
        class="pointer-events-none absolute inset-0 z-[79] rounded-[inherit] opacity-[0.001] backdrop-blur-[1.5px] transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] will-change-[opacity,backdrop-filter] data-[visible=true]:opacity-100 motion-reduce:transition-none"
        style={{
          "-webkit-mask-image":
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          "-webkit-mask-composite": "source-in",
          "mask-image":
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          "mask-composite": "intersect",
        }}
      />
      <Show when={presence.present()}>
        <div
          ref={(element) => setElements("dropzone", element)}
          data-component="session-dropzone"
          data-visible={props.active}
          class="pointer-events-none absolute inset-0 z-[80] grid place-items-center overflow-hidden rounded-[inherit] bg-[color-mix(in_srgb,var(--v2-text-text-base)_var(--session-dropzone-wash),transparent)] opacity-100 transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:opacity-0 motion-reduce:transition-none"
        >
          <div class="absolute inset-0 bg-v2-background-bg-base/25" />
          <div
            class="absolute inset-y-0 left-1/2 w-full -translate-x-1/2 md:max-w-200 2xl:max-w-[1000px]"
            style={{
              "-webkit-mask-image": "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
              "mask-image": "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
            }}
          >
            <div
              data-slot="session-dropzone-stripes"
              class="absolute inset-0 opacity-60"
              style={{
                background:
                  "repeating-linear-gradient(135deg, transparent 0px, transparent 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 24px)",
                "-webkit-mask-image":
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
                "mask-image":
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
              }}
            />
          </div>
          <div
            data-slot="session-dropzone-content"
            class="relative flex translate-y-0 flex-col items-center gap-5 opacity-100 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:translate-y-1 data-[visible=false]:opacity-0 motion-reduce:transition-none"
            data-visible={props.active}
          >
            <div
              data-slot="session-dropzone-upload"
              class="flex size-10 items-center justify-center rounded-full bg-[var(--session-dropzone-card)] text-v2-icon-icon-muted shadow-[var(--v2-elevation-floating)]"
              aria-hidden="true"
            >
              <Icon name="arrow-up" size="normal" class="text-v2-icon-icon-muted" />
            </div>
            <div class="text-[15px] font-[530] leading-6 text-v2-text-text-base">{presence.value()}</div>
          </div>
        </div>
      </Show>
    </>
  )
}
