import type { FooterView, MiniFormRequest, MiniPermissionRequest } from "./types"

export function pickBlockerView(input: { permission?: MiniPermissionRequest; form?: MiniFormRequest }): FooterView {
  if (input.permission) return { type: "permission", request: input.permission }
  if (input.form) return { type: "form", request: input.form }
  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") return "awaiting permission"
  if (view.type === "form") return "awaiting form"
  return ""
}
