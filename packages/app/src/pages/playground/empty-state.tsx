import { Mark } from "@opencode-ai/ui/logo"

export function EmptyState() {
  return (
    <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
      <Mark class="w-10 h-12 opacity-20 mb-4" />
      <p class="text-text-dimmed-base text-14-regular">What do you want to build?</p>
    </div>
  )
}
