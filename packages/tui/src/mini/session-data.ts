import type { FooterView, MiniFormRequest, MiniPermissionRequest } from "./types"
import { defaultMiniLanguage } from "./language"

export function pickBlockerView(input: { permission?: MiniPermissionRequest; form?: MiniFormRequest }): FooterView {
  if (input.permission) return { type: "permission", request: input.permission }
  if (input.form) return { type: "form", request: input.form }
  return { type: "prompt" }
}

export function blockerStatus(view: FooterView, language = defaultMiniLanguage) {
  if (view.type === "permission") return language.t("tui.mini.awaitingPermission")
  if (view.type === "form") return language.t("tui.mini.awaitingForm")
  return ""
}
