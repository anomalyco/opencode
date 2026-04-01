import type { NotificationPermissionState } from "@/context/platform"

export const notificationPermissionCopy = (state: NotificationPermissionState) => {
  if (state === "granted") {
    return {
      title: "Browser notifications",
      description: "Enabled in this browser. You can get alerts when OpenCode needs your input.",
      action: undefined,
    }
  }

  if (state === "default") {
    return {
      title: "Browser notifications",
      description: "Allow notifications so your phone or browser can alert you when OpenCode needs input.",
      action: "Enable",
    }
  }

  if (state === "denied") {
    return {
      title: "Browser notifications",
      description: "Blocked in this browser. Re-enable notifications in your browser or site settings to get alerts.",
      action: undefined,
    }
  }

  return {
    title: "Browser notifications",
    description: "This browser does not support system notifications.",
    action: undefined,
  }
}
