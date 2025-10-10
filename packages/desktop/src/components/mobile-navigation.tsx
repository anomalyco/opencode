import { Icon } from "@/ui"
import { Show } from "solid-js"

export type MobileTab = "files" | "editor" | "chat"

interface MobileNavigationProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  hasActiveSession: boolean
}

export default function MobileNavigation(props: MobileNavigationProps) {
  return (
    <nav
      class="fixed bottom-0 left-0 right-0 z-50 
             bg-background-panel/95 backdrop-blur-lg
             border-t border-border-subtle/30
             safe-area-bottom"
      style={{
        "padding-bottom": "var(--safe-area-inset-bottom)",
      }}
    >
      <div class="flex items-center justify-around h-16">
        <button
          onClick={() => props.onTabChange("files")}
          class="flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors"
          classList={{
            "text-primary": props.activeTab === "files",
            "text-text-muted": props.activeTab !== "files",
          }}
        >
          <Icon name="files" size={24} />
          <span class="text-xs font-medium">Files</span>
        </button>

        <button
          onClick={() => props.onTabChange("editor")}
          class="flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors"
          classList={{
            "text-primary": props.activeTab === "editor",
            "text-text-muted": props.activeTab !== "editor",
          }}
        >
          <Icon name="file" size={24} />
          <span class="text-xs font-medium">Editor</span>
        </button>

        <button
          onClick={() => props.onTabChange("chat")}
          class="flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors relative"
          classList={{
            "text-primary": props.activeTab === "chat",
            "text-text-muted": props.activeTab !== "chat",
          }}
        >
          <Icon name="message" size={24} />
          <span class="text-xs font-medium">Chat</span>
          <Show when={props.hasActiveSession && props.activeTab !== "chat"}>
            <div class="absolute top-2 right-1/4 w-2 h-2 bg-primary rounded-full" />
          </Show>
        </button>
      </div>
    </nav>
  )
}
