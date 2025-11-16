import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { Clipboard } from "../util/clipboard"
import { useToast } from "../ui/toast"

const HEALTH_INTERVAL_MS = 5000
const HEALTH_TIMEOUT_MS = 1000

export type ServerConnectionStatus = "connected" | "disconnected"

export const { use: useServerStatus, provider: ServerStatusProvider } = createSimpleContext({
  name: "ServerStatus",
  init: () => {
    const sdk = useSDK()
    const toast = useToast()
    const [status, setStatus] = createSignal<ServerConnectionStatus>("connected")

    let interval: NodeJS.Timeout | undefined
    let cancelled = false

    const checkStatus = async () => {
      if (cancelled) return
      try {
        const response = await fetch(`${sdk.url}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        })
        setStatus(response.ok ? "connected" : "disconnected")
      } catch {
        setStatus("disconnected")
      }
    }

    onMount(() => {
      checkStatus()
      interval = setInterval(checkStatus, HEALTH_INTERVAL_MS)
    })

    onCleanup(() => {
      cancelled = true
      if (interval) clearInterval(interval)
    })

    const copyUrl = async () => {
      try {
        await Clipboard.copy(sdk.url)
        toast.show({ message: "Server URL copied to clipboard", variant: "info" })
      } catch (error) {
        console.error("Failed to copy server URL", error)
        toast.show({ message: "Failed to copy server URL", variant: "error" })
      }
    }

    return {
      status,
      url: () => sdk.url,
      port: () => sdk.url.split(":").pop() ?? "unknown",
      refresh: () => checkStatus(),
      copyUrl,
    }
  },
})
