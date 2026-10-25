import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"

export function SessionWorkingIndicator(props: { sessionID?: string }) {
  const language = useLanguage()
  const server = useServer()
  const [elements, setElements] = createStore<{ indicator?: HTMLSpanElement }>({})

  const presence = createAnimatedPresence(
    () => {
      const id = props.sessionID

      return id && server.ctx.data.session.get(id)?.parentID && server.ctx.data.session.status(id) === "running"
        ? true
        : undefined
    },
    () => elements.indicator ?? null,
    () => props.sessionID,
  )

  return (
    <Show when={presence.present()}>
      <span
        ref={(element) => setElements("indicator", element)}
        role="status"
        aria-label={language.t("session.timeline.working")}
        data-visible={presence.show()}
        // Cancel the header's 2px gap at the end of the collapse so unmounting doesn't nudge the title.
        class="ms-1 me-0.5 flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden text-v2-icon-icon-muted duration-200 ease-out data-[visible=false]:ms-0 data-[visible=false]:-me-0.5 data-[visible=false]:w-0 data-[visible=false]:opacity-0 motion-reduce:animate-none motion-reduce:transition-none"
        classList={{
          "transition-[width,margin,opacity]": presence.animate(),
          // Presence waits for animationend; transitions alone would unmount the icon immediately.
          "animate-out fade-out fill-mode-forwards": presence.animate() && !presence.show(),
        }}
      >
        <SessionProgressIndicatorV2 class="shrink-0" />
      </span>
    </Show>
  )
}
