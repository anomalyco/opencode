import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"

export type MarkdownViewMode = "rendered" | "source"

export function MarkdownViewToggle(props: { mode: MarkdownViewMode; onChange: (mode: MarkdownViewMode) => void }) {
  const language = useLanguage()

  return (
    <div class="flex items-center gap-1 bg-surface-base rounded-md p-0.5">
      <Button
        variant={props.mode === "rendered" ? "secondary" : "ghost"}
        size="small"
        class="px-2 py-0.5 text-12-regular"
        onClick={() => props.onChange("rendered")}
      >
        {language.t("markdown.view.rendered")}
      </Button>
      <Button
        variant={props.mode === "source" ? "secondary" : "ghost"}
        size="small"
        class="px-2 py-0.5 text-12-regular"
        onClick={() => props.onChange("source")}
      >
        {language.t("markdown.view.source")}
      </Button>
    </div>
  )
}
