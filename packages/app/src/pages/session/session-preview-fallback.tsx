import { useLanguage } from "@/context/language"

export function SessionPreviewFallback() {
  const language = useLanguage()
  const msg = () => language.t("session.preview.notReady")

  return (
    <div
      data-slot="preview-fallback"
      class="size-full min-h-0 flex items-center justify-center px-6 py-8 text-center"
    >
      <div role="status" class="flex w-full max-w-160 flex-col items-center gap-4" aria-label={msg()}>
        <div data-component="codle-preview-loader" aria-hidden="true">
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
          <span data-slot="block" />
        </div>
        <div class="text-12-medium text-text-weak min-w-0 break-words text-center leading-5">{msg()}</div>
      </div>
    </div>
  )
}
