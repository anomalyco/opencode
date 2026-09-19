import { createResource } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"

export function createCameraAvailability() {
  const platform = usePlatform()
  const supported = platform.platform === "web" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const [available, actions] = createResource(
    async () => {
      if (!supported || !navigator.mediaDevices.enumerateDevices) return false
      const denied = await navigator.permissions?.query({ name: "camera" }).then(
        (permission) => permission.state === "denied",
        () => false,
      )
      if (denied) return false
      return navigator.mediaDevices.enumerateDevices().then(
        (devices) => devices.some((device) => device.kind === "videoinput"),
        () => false,
      )
    },
    { initialValue: false },
  )
  return { supported, available, refetch: actions.refetch }
}
