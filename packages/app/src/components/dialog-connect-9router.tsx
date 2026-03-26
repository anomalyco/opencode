import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
}

const NINEROUTER_ID = "9router"
const NINEROUTER_NAME = "9Router"
const DEFAULT_BASE_URL = "http://localhost:20123/v1"

const DEFAULT_MODELS: Record<string, { name: string }> = {
  "claude-sonnet-4-6": { name: "Claude Sonnet 4.6" },
  "claude-opus-4-6": { name: "Claude Opus 4.6" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5" },
}

export function DialogConnect9Router(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const [form, setForm] = createStore({
    baseURL: DEFAULT_BASE_URL,
    err: { baseURL: undefined as string | undefined },
  })

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const baseURL = form.baseURL.trim()

      if (!baseURL || !/^https?:\/\//.test(baseURL)) {
        setForm("err", "baseURL", "A valid http/https URL is required")
        return null
      }

      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== NINEROUTER_ID)

      await globalSync.updateConfig({
        provider: {
          [NINEROUTER_ID]: {
            npm: "@ai-sdk/openai-compatible",
            name: NINEROUTER_NAME,
            options: {
              baseURL,
              // openai-compatible SDK requires a non-empty apiKey even for
              // local servers that don't enforce auth
              apiKey: "9router",
            },
            models: DEFAULT_MODELS,
          },
        },
        disabled_providers: nextDisabled,
      })
      return { name: NINEROUTER_NAME }
    },
    onSuccess: (result) => {
      if (!result) return
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `Connected to ${result.name}`,
        description: `${result.name} is ready to use`,
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    setForm("err", "baseURL", undefined)
    saveMutation.mutate()
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="openrouter" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">Connect 9Router</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            9Router is a local OpenAI-compatible proxy. Enter the URL of your running 9Router container.
          </p>

          <TextField
            autofocus
            label="9Router URL"
            placeholder={DEFAULT_BASE_URL}
            description="The base URL of your 9Router container (e.g. http://localhost:20123/v1)"
            value={form.baseURL}
            onChange={(v) => {
              setForm("baseURL", v)
              setForm("err", "baseURL", undefined)
            }}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />

          <p class="text-12-regular text-text-weak">
            Pre-configured models: Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5
          </p>

          <div class="flex self-start">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
