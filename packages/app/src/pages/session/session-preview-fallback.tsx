import { useLanguage } from "@/context/language"
import { SessionPreviewMascot } from "./session-preview-mascot"

export function SessionPreviewFallback() {
  const language = useLanguage()
  const title = () => language.t("session.preview.generating.title")
  const hint = () => language.t("session.preview.generating.hint")

  return (
    <div
      data-slot="preview-fallback"
      class="size-full min-h-0 flex items-center justify-center px-6 py-8 text-center"
    >
      <div role="status" class="flex w-full max-w-160 flex-col items-center gap-[14px]" aria-label={title()}>
        <SessionPreviewMascot size={84} />
        <div class="flex flex-col items-center gap-[5px] min-w-0 break-words">
          <span style={{ "font-size": "13.5px", "font-weight": "600", color: "var(--app-ink)" }}>{title()}</span>
          <span style={{ "font-size": "11.5px", color: "var(--app-muted)" }}>{hint()}</span>
        </div>
      </div>
    </div>
  )
}
