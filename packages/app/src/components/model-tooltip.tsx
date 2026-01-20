import { Show, type Component } from "solid-js"

type ModelInfo = {
  id: string
  name: string
  provider: {
    name: string
  }
  capabilities: {
    reasoning: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
  }
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

export const ModelTooltip: Component<{ model: ModelInfo }> = (props) => {
  const title = () => `${sourceName(props.model)} ${props.model.name}`
  const inputs = () => {
    const input = props.model.capabilities.input
    const order: Array<keyof ModelInfo["capabilities"]["input"]> = ["text", "image", "audio", "video", "pdf"]
    const entries = order.filter((key) => input[key])
    return entries.length ? entries.join(", ") : undefined
  }
  const reasoning = () => (props.model.capabilities.reasoning ? "Allows reasoning" : "No reasoning")
  const context = () => `Context limit ${props.model.limit.context.toLocaleString()}`

  return (
    <div class="flex flex-col gap-1 py-1">
      <div class="text-13-medium">{title()}</div>
      <Show when={inputs()}>{(value) => <div class="text-12-regular">Allows: {value()}</div>}</Show>
      <div class="text-12-regular">{reasoning()}</div>
      <div class="text-12-regular">{context()}</div>
    </div>
  )
}
