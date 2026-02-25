import type { DeviceFrame } from "@/context/playground"

export const DEVICE_SIZES: Record<DeviceFrame, { width?: number; height?: number; label: string }> = {
  auto: { label: "Auto" },
  mobile: { width: 375, height: 812, label: "Mobile" },
  tablet: { width: 768, height: 1024, label: "Tablet" },
  desktop: { width: 1440, height: 900, label: "Desktop" },
}
