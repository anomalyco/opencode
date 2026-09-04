import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Toast, showToast, toaster, type ToastOptions } from "@opencode-ai/ui/toast"
import type { JSX } from "solid-js"

type AppToastOptions = Omit<ToastOptions, "icon"> & {
  icon?: IconProps["name"]
}

export function ToastRegion() {
  return <Toast.Region />
}

function showAppToast(options: AppToastOptions | string) {
  if (typeof options === "string") return showToast(options)

  return showToast({
    ...options,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

export { showAppToast as showToast }

export function dismissToast(toastId: number) {
  return toaster.dismiss(toastId)
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastOptions["variant"]) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return undefined
  // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
  return (() => <Icon name={name} />) as unknown as JSX.Element
}
