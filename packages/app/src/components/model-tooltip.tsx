import { Show, type Component } from "solid-js"

type InputKey = "text" | "image" | "audio" | "video" | "pdf"
type InputMap = Record<InputKey, boolean>

type ModelInfo = {
  id: string
  name: string
  provider: {
    name: string
  }
  capabilities?: {
    reasoning: boolean
    input: InputMap
  }
  modalities?: {
    input: Array<string>
  }
  reasoning?: boolean
  limit: {
    context: number
  }
}

function sourceName(model: ModelInfo) {
  const value = `${model.id} ${model.name}`.toLowerCase()

  if (/claude|anthropic/.test(value)) return "Anthropic"
  if (/gpt|o[1-4]|codex|openai/.test(value)) return "OpenAI"
  if (/gemini|palm|bard|google/.test(value)) return "Google"
  if (/grok|xai/.test(value)) return "xAI"
  if (/llama|meta/.test(value)) return "Meta"

  return model.provider.name
}

export const ModelTooltip: Component<{ model: ModelInfo; latest?: boolean; free?: boolean }> = (props) => {
  const title = () => {
    const tags: Array<string> = []
    if (props.latest) tags.push("Latest")
    if (props.free) tags.push("Free")
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""
    return `${sourceName(props.model)} ${props.model.name}${suffix}`
  }
  const inputs = () => {
    if (props.model.capabilities) {
      const input = props.model.capabilities.input
      const order: Array<InputKey> = ["text", "image", "audio", "video", "pdf"]
      const entries = order.filter((key) => input[key])
      return entries.length ? entries.join(", ") : undefined
    }
    return props.model.modalities?.input?.join(", ")
  }
  const reasoning = () => {
    if (props.model.capabilities) return props.model.capabilities.reasoning ? "Allows reasoning" : "No reasoning"
    return props.model.reasoning ? "Allows reasoning" : "No reasoning"
  }
  const context = () => `Context limit ${props.model.limit.context.toLocaleString()}`

  return (
    <div class="flex flex-col gap-1 py-1">
      <div class="text-13-medium">{title()}</div>
      <Show when={inputs()}>
        {(value) => <div class="text-12-regular text-text-invert-base">Allows: {value()}</div>}
      </Show>
      <div class="text-12-regular text-text-invert-base">{reasoning()}</div>
      <div class="text-12-regular text-text-invert-base">{context()}</div>
    </div>
  )
}
