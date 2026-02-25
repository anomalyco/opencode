import { createEffect, on, onCleanup, onMount } from "solid-js"
import { createSandboxHTML, createSandboxListener, postToSandbox, type FromSandbox } from "./sandbox"
import { createBridge } from "./bridge"
import { useSDK } from "@/context/sdk"
import type { DeviceFrame, PlaygroundWindow } from "@/context/playground"

const DEVICE_SIZES: Record<DeviceFrame, { width?: number; height?: number }> = {
  auto: {},
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
}

export function Preview(props: {
  window: PlaygroundWindow
  onError?: (message: string) => void
  onElementSelected?: (selector: string, tagName: string, textContent: string) => void
  onRendered?: () => void
}) {
  let iframe: HTMLIFrameElement | undefined
  const sdk = useSDK()

  onMount(() => {
    if (!iframe) return

    const bridge = createBridge({
      sdk: sdk as any,
      directory: sdk.directory,
      windowSessionID: props.window.sessionID,
      model: props.window.model,
      iframe,
      onError: props.onError,
    })

    const unsub = createSandboxListener((msg, source) => {
      if (source !== iframe?.contentWindow) return

      switch (msg.type) {
        case "error":
          props.onError?.(msg.message)
          break
        case "element-selected":
          props.onElementSelected?.(msg.selector, msg.tagName, msg.textContent)
          break
        case "rendered":
          props.onRendered?.()
          break
        case "ready":
          if (props.window.code) {
            postToSandbox(iframe!, { type: "render", html: props.window.code })
          }
          break
        default:
          bridge.handle(msg, source)
      }
    })

    onCleanup(() => {
      unsub()
      bridge.dispose()
    })
  })

  createEffect(
    on(
      () => props.window.code,
      (code) => {
        if (!iframe || !code) return
        postToSandbox(iframe, { type: "render", html: code })
      },
    ),
  )

  const device = () => DEVICE_SIZES[props.window.deviceFrame]
  const frameStyle = () => {
    const d = device()
    if (!d.width) return { width: "100%", height: "100%" }
    return {
      width: `${d.width}px`,
      height: `${d.height}px`,
      "max-width": "100%",
      "max-height": "100%",
    }
  }

  return (
    <div class="size-full flex items-center justify-center overflow-hidden bg-white">
      <iframe
        ref={iframe}
        sandbox="allow-scripts"
        srcdoc={createSandboxHTML()}
        referrerpolicy="no-referrer"
        class="border-0"
        style={frameStyle()}
        title={props.window.title}
      />
    </div>
  )
}
