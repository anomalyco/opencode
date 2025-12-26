import { Show, type ParentProps } from "solid-js"
import { usePlatform } from "@/context/platform"

export function StatusBar(props: ParentProps) {
  const platform = usePlatform()
  return (
    <div class="h-8 w-full shrink-0 flex items-center justify-between px-2 border-t border-border-weak-base bg-background-base">
      <Show when={platform.version}>
        <span class="text-12-regular text-text-weak">v{platform.version}</span>
      </Show>
      <div class="flex items-center">{props.children}</div>
    </div>
  )
}
