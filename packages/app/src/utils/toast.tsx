import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Toast, showToast as showLegacyToast, type ToastOptions, type ToastVariant } from "@opencode-ai/ui/toast"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/components/toast-v2.jsx"

const USE_V2_TOAST = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

export function ToastRegion() {
  if (USE_V2_TOAST) return <ToastV2.Region />
  return <Toast.Region />
}

export function showToast(options: ToastOptions | string) {
  if (!USE_V2_TOAST) return showLegacyToast(options)
  if (typeof options === "string") return showToastV2(options)

  return showToastV2({
    ...options,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastVariant | undefined) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return
  return <Icon name={name} />
}
