import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { CursorInfo } from "./code-mirror-view"

type Props = {
  info: CursorInfo | undefined
}

export default function CmStatusBar(props: Props) {
  const language = useLanguage()
  return (
    <Show when={props.info}>
      {(info) => (
        <div
          class="flex items-center gap-3 px-3 py-1 text-xs text-text-weak border-t border-border-weak-base bg-surface-base select-none"
          data-testid="cm-status-bar"
        >
          <span>
            {language.t("fileViewer.editor.statusBar.line", { count: info().line })},{" "}
            {language.t("fileViewer.editor.statusBar.col", { count: info().col })}
          </span>
          <Show when={info().selLength > 0}>
            <span>{language.t("fileViewer.editor.statusBar.sel", { count: info().selLength })}</span>
          </Show>
        </div>
      )}
    </Show>
  )
}
