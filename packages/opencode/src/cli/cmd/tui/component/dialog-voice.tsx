import { createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { Auth } from "@/auth"
import { useSDK } from "@tui/context/sdk"

const GROQ_MODELS = [
  { id: "whisper-large-v3-turbo", name: "Whisper Large V3 Turbo", description: "Fast" },
  { id: "whisper-large-v3", name: "Whisper Large V3", description: "Accurate" },
]

const OPENAI_MODELS = [{ id: "whisper-1", name: "Whisper 1", description: "Standard" }]

export function DialogVoice() {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()

  const options = createMemo(() => [
    {
      title: "Groq Whisper",
      value: "groq",
      description: "(Recommended - Fast)",
      category: "Providers",
      onSelect: () => showModelDialog("groq"),
    },
    {
      title: "OpenAI Whisper",
      value: "openai",
      description: "(API key)",
      category: "Providers",
      onSelect: () => showModelDialog("openai"),
    },
  ])

  async function showModelDialog(provider: "groq" | "openai") {
    const auth = await Auth.get(provider)
    if (!auth) {
      toast.show({
        message: `Please connect ${provider} first: /connect ${provider}`,
        variant: "error",
      })
      dialog.clear()
      return
    }

    const models = provider === "groq" ? GROQ_MODELS : OPENAI_MODELS

    dialog.replace(() => (
      <DialogSelect
        title={`${provider === "groq" ? "Groq" : "OpenAI"} Model`}
        options={models.map((m) => ({
          title: m.name,
          value: m.id,
          description: m.description,
          onSelect: async () => {
            await saveConfig(provider, m.id)
          },
        }))}
      />
    ))
  }

  async function saveConfig(provider: "groq" | "openai", model: string) {
    try {
      await sdk.client.config.update({
        config: {
          voice: {
            provider,
            model,
          },
        },
      } as any)
      await sync.bootstrap()
      toast.show({
        message: `Voice configured: ${provider}/${model}`,
        variant: "success",
      })
      dialog.clear()
    } catch (e) {
      toast.show({
        message: `Failed to save config: ${e}`,
        variant: "error",
      })
    }
  }

  return <DialogSelect title="Voice Provider" options={options()} />
}
