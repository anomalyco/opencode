import { SshErrorBucket } from "./types"

export interface RecoverySuggestion {
  action: string
  description: string
  priority: "high" | "medium" | "low"
}

export interface ErrorRecoveryInfo {
  suggestions: RecoverySuggestion[]
  canRetry: boolean
  retryDelayMs?: number
}

export function getRecoverySuggestions(
  bucket: SshErrorBucket,
  message: string,
  details?: string
): ErrorRecoveryInfo {
  const suggestions: RecoverySuggestion[] = []
  let canRetry = false
  let retryDelayMs: number | undefined

  const lowerMessage = message.toLowerCase()
  const lowerDetails = details?.toLowerCase() ?? ""

  switch (bucket) {
    case "auth-failure":
      suggestions.push({
        action: "verify_credentials",
        description: "Check that your SSH key is correct and has the right permissions (chmod 600)",
        priority: "high",
      })
      suggestions.push({
        action: "check_identity_file",
        description: "Verify the identity file path is correct and the key is not password-protected",
        priority: "high",
      })
      if (!lowerMessage.includes("agent") && !lowerDetails.includes("agent")) {
        suggestions.push({
          action: "try_agent_forwarding",
          description: "Enable SSH agent forwarding if using an SSH agent",
          priority: "medium",
        })
      }
      suggestions.push({
        action: "try_multiple_keys",
        description: "Try multiple identity files in order",
        priority: "medium",
      })
      canRetry = false
      break

    case "host-key-failure":
      suggestions.push({
        action: "update_known_hosts",
        description: "Remove the old host key from ~/.ssh/known_hosts and reconnect",
        priority: "high",
      })
      suggestions.push({
        action: "verify_host",
        description: "Verify the host identity has actually changed (not a man-in-the-middle attack)",
        priority: "high",
      })
      canRetry = false
      break

    case "network-failure":
      suggestions.push({
        action: "check_network",
        description: "Verify your network connection and that the host is reachable",
        priority: "high",
      })
      suggestions.push({
        action: "check_firewall",
        description: "Ensure your firewall allows SSH connections on the specified port",
        priority: "medium",
      })
      if (lowerMessage.includes("timeout") || lowerDetails.includes("timeout")) {
        suggestions.push({
          action: "increase_timeout",
          description: "Try increasing the connection timeout",
          priority: "low",
        })
      }
      canRetry = true
      retryDelayMs = 2000
      break

    case "port-forward-failure":
      suggestions.push({
        action: "check_port_availability",
        description: "Verify the remote port is not already in use",
        priority: "high",
      })
      suggestions.push({
        action: "check_remote_server",
        description: "Ensure the OpenCode server is running on the remote host",
        priority: "high",
      })
      suggestions.push({
        action: "try_different_port",
        description: "Try a different remote port if the current one is unavailable",
        priority: "medium",
      })
      canRetry = true
      retryDelayMs = 1000
      break

    case "config-error":
      suggestions.push({
        action: "validate_ssh_config",
        description: "Check your SSH config file for syntax errors",
        priority: "high",
      })
      suggestions.push({
        action: "try_isolation_mode",
        description: "Try using isolation mode to bypass SSH config file issues",
        priority: "medium",
      })
      canRetry = false
      break

    case "unknown":
      suggestions.push({
        action: "check_logs",
        description: "Review the error details and SSH logs for more information",
        priority: "high",
      })
      suggestions.push({
        action: "verify_ssh_installation",
        description: "Ensure SSH is properly installed and accessible",
        priority: "medium",
      })
      canRetry = true
      retryDelayMs = 1000
      break
  }

  return {
    suggestions,
    canRetry,
    retryDelayMs,
  }
}

export function formatRecoveryMessage(recovery: ErrorRecoveryInfo): string {
  const highPriority = recovery.suggestions.filter((s) => s.priority === "high")
  if (highPriority.length > 0) {
    return highPriority.map((s) => s.description).join(". ") + "."
  }
  return recovery.suggestions.map((s) => s.description).join(". ") + "."
}
