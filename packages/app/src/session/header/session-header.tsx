import { isMobileLayout } from "@opencode/ui/mobile-layout"
import { Show } from "solid-js"

export function SessionHeaderSpacer(props: { visible: boolean }) {
  const isDesktop = () => !isMobileLayout()

  return (
    <Show when={isDesktop() && props.visible}>
      <div class="size-7 shrink-0" aria-hidden />
    </Show>
  )
}
