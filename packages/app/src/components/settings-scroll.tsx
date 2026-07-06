import { type Component, type JSX } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"

export const SettingsScroll: Component<{ children: JSX.Element }> = (props) => {
  return (
    <ScrollView class="h-full">
      <div class="flex flex-col px-4 pb-10 sm:px-10 sm:pb-10">{props.children}</div>
    </ScrollView>
  )
}
