import type { PermissionRequest } from "@opencode-ai/client"
import type { FormWithLocation } from "../../context/data"

export type SessionAttention =
  | { type: "permission"; request: PermissionRequest }
  | { type: "form"; request: FormWithLocation }

export function selectSessionAttention(
  permissions: readonly PermissionRequest[],
  forms: readonly FormWithLocation[],
  previous?: SessionAttention,
): SessionAttention | undefined {
  if (previous?.type === "permission") {
    const current = permissions.find((request) => request.id === previous.request.id)
    if (current) return { type: "permission", request: current }
  }

  if (previous?.type === "form") {
    const current = forms.find((request) => request.id === previous.request.id)
    if (current) return { type: "form", request: current }
  }

  const permission = permissions[0]
  if (permission) return { type: "permission", request: permission }

  const form = forms[0]
  if (form) return { type: "form", request: form }
  return undefined
}
