import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"

export type DesignModelChoice = {
  key: string
  name: string
  providerID: string
  modelID: string
  free: boolean
  cost?: string
}

export function designModelKey(model: Pick<DesignModelChoice, "providerID" | "modelID">) {
  return `${model.providerID}:${model.modelID}`
}

export function DesignModelSelect(props: {
  class?: string
  models: DesignModelChoice[]
  selected: DesignModelChoice | undefined
  loading: boolean
  onSelect: (model: DesignModelChoice | null | undefined) => void
}) {
  const language = useLanguage()

  return (
    <Select
      class={props.class ?? "w-full"}
      options={props.models}
      current={props.selected}
      value={(item) => item.key}
      label={(item) => `${item.name} · ${item.providerID}`}
      onSelect={props.onSelect}
      placeholder={props.loading ? language.t("design.ai.modelLoading") : language.t("design.ai.modelDefault")}
    >
      {(item) => (
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate">{item.name}</span>
          <span class="ms-auto shrink-0 text-[10px] text-v2-text-text-faint">
            {item.free ? language.t("design.ai.modelFree") : item.cost}
          </span>
        </span>
      )}
    </Select>
  )
}
