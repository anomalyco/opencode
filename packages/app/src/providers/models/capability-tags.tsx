import { For, Show, createMemo, type Component } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { useLanguage } from "@/runtime/i18n/language"
import type { ModelSelection } from "./selection"

type ModelInfo = NonNullable<ReturnType<ModelSelection["current"]>>

/** Input modalities worth a badge; text is implied by every model and would only add noise. */
const MODALITIES = ["image", "video", "audio", "pdf"] as const

const MODALITY_KEYS = {
  image: "model.details.input.image",
  video: "model.details.input.video",
  audio: "model.details.input.audio",
  pdf: "model.details.input.pdf",
} as const

function contextAndOutput(model: ModelInfo) {
  return { context: model.limit?.context ?? 0, output: model.limit?.output ?? 0 }
}

function money(value: number) {
  return `$${Number(value.toFixed(2))}`
}

/** Whether a row has anything to badge, so a description line only appears when it earns its space. */
export function hasCapabilityTags(model: ModelInfo) {
  const input = model.capabilities?.input
  const { context, output } = contextAndOutput(model)
  return (
    MODALITIES.some((modality) => input?.[modality] === true) ||
    model.capabilities?.toolcall === true ||
    context > 0 ||
    output > 0 ||
    (model.cost?.input ?? 0) > 0
  )
}

/** The model's input modalities, tool support, token limits and price, for a picker row. */
export const ModelCapabilityTags: Component<{ model: ModelInfo }> = (props) => {
  const language = useLanguage()
  const compact = createMemo(() =>
    new Intl.NumberFormat(language.intl(), {
      notation: "compact",
      maximumFractionDigits: 0,
      roundingMode: "trunc",
    }),
  )
  const limits = () => {
    const { context, output } = contextAndOutput(props.model)
    if (context && output) return `${compact().format(context)}/${compact().format(output)}`
    if (context) return compact().format(context)
    if (output) return compact().format(output)
    return ""
  }
  const price = () => {
    const cost = props.model.cost
    if (!cost || cost.input === 0) return ""
    return `${money(cost.input)}/${money(cost.output)}`
  }

  return (
    <Show when={hasCapabilityTags(props.model)}>
      <For each={MODALITIES.filter((modality) => props.model.capabilities?.input[modality] === true)}>
        {(modality) => <Badge class="shrink-0">{language.t(MODALITY_KEYS[modality])}</Badge>}
      </For>
      <Show when={props.model.capabilities?.toolcall}>
        <Badge class="shrink-0">{language.t("model.details.tools")}</Badge>
      </Show>
      <Show when={limits()}>
        {(value) => <Badge class="shrink-0 tabular-nums">{value()}</Badge>}
      </Show>
      <Show when={price()}>
        {(value) => <Badge class="shrink-0 tabular-nums">{value()}</Badge>}
      </Show>
    </Show>
  )
}
