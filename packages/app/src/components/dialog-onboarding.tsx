import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Splash } from "@opencode-ai/ui/logo"
import { DialogSelectProvider } from "./dialog-select-provider"

const ONBOARDING_KEY = "opencode:onboarding-shown"

export function markOnboardingShown() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1")
  } catch {
    // ignore
  }
}

export function wasOnboardingShown(): boolean {
  try {
    return !!localStorage.getItem(ONBOARDING_KEY)
  } catch {
    return false
  }
}

export function DialogOnboarding() {
  const dialog = useDialog()

  const getStarted = () => {
    markOnboardingShown()
    dialog.show(() => <DialogSelectProvider />)
  }

  const skip = () => {
    markOnboardingShown()
    dialog.close()
  }

  return (
    <Dialog transition>
      <div class="flex flex-col items-center gap-8 px-6 pb-8 pt-4 text-center max-w-sm mx-auto">
        <Splash class="w-14 h-[4.375rem]" />

        <div class="flex flex-col gap-2">
          <h2 class="text-20-medium text-text-strong">Welcome to CoBuilder</h2>
          <p class="text-14-regular text-text-base">
            CoBuilder is an AI coding assistant that works with your choice of provider.
            Connect a provider to get started.
          </p>
        </div>

        <div class="flex flex-col gap-3 w-full">
          <div class="flex flex-col gap-2 text-left bg-surface-base rounded-lg p-4">
            <div class="flex items-center gap-3">
              <div class="w-2 h-2 rounded-full bg-accent-base shrink-0" />
              <span class="text-13-medium text-text-strong">9Router</span>
              <span class="text-12-regular text-text-weak">Local Paperclip proxy</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="w-2 h-2 rounded-full bg-icon-base shrink-0" />
              <span class="text-13-medium text-text-strong">Anthropic, OpenAI, Google</span>
              <span class="text-12-regular text-text-weak">API key</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="w-2 h-2 rounded-full bg-icon-base shrink-0" />
              <span class="text-13-medium text-text-strong">OpenRouter, and more</span>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 w-full">
          <Button class="w-full" onClick={getStarted}>
            Connect a Provider
          </Button>
          <button
            type="button"
            class="text-12-regular text-text-weak hover:text-text-base transition-colors py-1"
            onClick={skip}
          >
            Skip for now
          </button>
        </div>
      </div>
    </Dialog>
  )
}
