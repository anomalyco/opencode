import { Button } from "@yunpat/ui/button"
import { Icon } from "@yunpat/ui/icon"
import { BrandHero } from "@yunpat/ui/brand-hero"
import { useDialog } from "@yunpat/ui/context/dialog"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { useProviders } from "@/hooks/use-providers"
import { createSignal, For, Match, Show, Switch } from "solid-js"

type Step = "welcome" | "done"

export function SetupWizard(props: { onComplete: () => void }) {
  const dialog = useDialog()
  const providers = useProviders()

  const [step, setStep] = createSignal<Step>("welcome")

  function connectProvider() {
    dialog.show(() => <DialogSelectProvider />)
  }

  function finish() {
    localStorage.setItem("yunpat.setup.complete", "1")
    props.onComplete()
  }

  const hasConnected = () => providers.connected().length > 0

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base p-6">
      <div class="flex flex-col items-center max-w-md w-full text-center">
        <BrandHero size="md" class="w-56 max-w-full rounded-2xl mb-6" />

        <Switch>
          <Match when={step() === "welcome"}>
            <h1 class="text-24-medium text-text-strong mb-2">欢迎使用云熙专利智能体</h1>
            <p class="text-14-regular text-text-weak mb-8">
              Connect an AI provider to get started. You'll need an API key from your provider.
            </p>
            <Button size="large" onClick={connectProvider}>
              <Icon name="providers" />
              Connect Provider
            </Button>

            <Show when={hasConnected()}>
              <Button variant="ghost" class="mt-4" onClick={finish}>
                I've already connected a provider
              </Button>
            </Show>

            <button
              type="button"
              class="mt-6 text-12-regular text-text-weak hover:text-text-base underline"
              onClick={finish}
            >
              Skip setup
            </button>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

export function useSetupNeeded() {
  const providers = useProviders()

  return () => {
    if (typeof localStorage === "undefined") return false
    if (localStorage.getItem("yunpat.setup.complete") === "1") return false
    return providers.connected().length === 0
  }
}
