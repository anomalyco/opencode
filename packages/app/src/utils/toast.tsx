import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import type { ToastOptions, ToastVariant } from "@opencode-ai/ui/toast"
import { ToastV2, showToastV2, toasterV2 } from "@opencode-ai/ui/v2/toast-v2"

export function ToastRegion() {
  return <ToastV2.Region />
}

export function showToast(options: ToastOptions | string) {
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

export function dismissToast(toastId: number) {
  return toasterV2.dismiss(toastId)
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastVariant | undefined) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return
  return <Icon name={name} />
}
