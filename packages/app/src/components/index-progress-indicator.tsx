import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"

export function IndexProgressIndicator() {
  const file = useFile()
  const language = useLanguage()

  return (
    <Portal>
      <Show when={file.indexing()}>
        <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 shadow-[var(--v2-elevation-raised)]">
          <LoaderV2 class="h-4 w-4" />
          <span class="text-[12px] leading-none text-v2-text-text-base">
            {language.t("index.progress.refreshing")}
          </span>
        </div>
      </Show>
    </Portal>
  )
}
