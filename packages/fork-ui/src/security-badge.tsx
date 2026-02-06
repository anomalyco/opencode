import { createSignal, onMount, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"

type SecurityStatus = "secure" | "insecure" | "local"

interface SecurityState {
  status: SecurityStatus
  icon: "lock" | "lock-open" | "home"
  color: string
  tooltip: string
  title: string
  description: string
}

function getSecurityStatus(): SecurityStatus {
  const hostname = window.location.hostname
  const protocol = window.location.protocol

  // Check for localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost")) {
    return "local"
  }

  // Check for HTTPS
  if (protocol === "https:") {
    return "secure"
  }

  return "insecure"
}

function getSecurityState(status: SecurityStatus): SecurityState {
  switch (status) {
    case "secure":
      return {
        status: "secure",
        icon: "lock",
        color: "text-green-500",
        tooltip: "Connection is secure (HTTPS)",
        title: "Secure Connection",
        description:
          "Your connection to this server is encrypted using HTTPS. Data transmitted between your browser and the server is protected.",
      }
    case "insecure":
      return {
        status: "insecure",
        icon: "lock-open",
        color: "text-red-500",
        tooltip: "Connection is not secure",
        title: "Insecure Connection",
        description:
          "Your connection is not encrypted. Credentials and data could be intercepted. Consider using HTTPS via a reverse proxy.",
      }
    case "local":
      return {
        status: "local",
        icon: "home",
        color: "text-blue-500",
        tooltip: "Local connection",
        title: "Local Connection",
        description:
          "You're connected to a local server. Local connections don't require HTTPS encryption since data doesn't travel over the network.",
      }
  }
}

export function SecurityBadge() {
  const [status, setStatus] = createSignal<SecurityStatus>(getSecurityStatus())
  const state = () => getSecurityState(status())

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      setStatus(getSecurityStatus())
    }
  }

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange)
  })

  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  })

  return (
    <Popover
      trigger={
        <Tooltip value={state().tooltip}>
          <IconButton icon={state().icon} variant="ghost" size="normal" class={`security-badge-icon ${state().color}`} />
        </Tooltip>
      }
      title="Connection Security"
    >
      <div data-slot="security-badge-content">
        <p>{state().description}</p>
      </div>
    </Popover>
  )
}
