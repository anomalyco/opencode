import { useLanguage } from "@/context/language"

export function SessionPreviewFallback() {
  const language = useLanguage()
  const msg = () => language.t("session.preview.notReady")

  return (
    <div data-slot="preview-fallback" class="size-full flex items-center justify-center">
      <div role="status" class="flex flex-col items-center gap-4" aria-label={msg()}>
        <div data-component="codle-preview-loader" aria-hidden="true">
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
        </div>
        <div class="text-12-medium text-text-weak">{msg()}</div>
      </div>
    </div>
  )
}
