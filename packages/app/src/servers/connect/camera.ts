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

// Pages served over plain HTTP cannot open the camera. QR codes carry JSON, not a link, so the pasted link is the way in.
export function cameraHint() {
  return window.isSecureContext ? "server.connect.camera.unavailable" : "server.connect.camera.native"
}
