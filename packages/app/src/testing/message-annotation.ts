import type { MessageAnnotationTriggerVariant } from "@/pages/session/message-annotation-trigger"

export type MessageAnnotationWindow = Window & {
  __opencode_e2e?: {
    messageAnnotation?: {
      enabled?: boolean
      variant?: MessageAnnotationTriggerVariant
    }
  }
}

const valid = (value: unknown): value is MessageAnnotationTriggerVariant =>
  value === "icon" || value === "toolbar" || value === "mini"

export const messageAnnotationEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as MessageAnnotationWindow).__opencode_e2e?.messageAnnotation?.enabled === true
}

const root = () => {
  if (!messageAnnotationEnabled()) return
  return (window as MessageAnnotationWindow).__opencode_e2e?.messageAnnotation
}

export const messageAnnotationVariant = (fallback: MessageAnnotationTriggerVariant) => {
  const state = root()
  if (!state) return fallback
  return valid(state.variant) ? state.variant : fallback
}

export const setMessageAnnotationVariant = (variant: MessageAnnotationTriggerVariant | undefined) => {
  const state = root()
  if (!state) return
  state.variant = variant
}
