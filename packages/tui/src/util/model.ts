import { createLanguage } from "../i18n/translate"

export function parse(value: string) {
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function formatRef(model: { providerID: string; id: string; variant?: string }) {
  return [model.providerID, model.id, model.variant].filter((value) => value !== undefined).join("/")
}

export function switchLabel(
  model: { providerID: string; id: string; variant?: string },
  models?: readonly { providerID: string; id: string; name: string }[],
  previous?: { providerID: string; id: string; variant?: string },
  t = createLanguage(() => "en").t,
) {
  if (previous?.providerID === model.providerID && previous.id === model.id)
    return t("tui.app.variantSwitched", { variant: model.variant ?? t("tui.app.defaultVariant") })
  const display = models?.find((item) => item.providerID === model.providerID && item.id === model.id)?.name
  if (display === undefined) return t("tui.app.modelSwitched", { model: formatRef(model) })
  const variant = model.variant && model.variant !== "default" ? ` (${model.variant})` : ""
  return t("tui.app.modelSwitched", { model: `${display}${variant}` })
}
