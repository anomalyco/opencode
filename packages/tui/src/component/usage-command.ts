import { resolveUsageProvider } from "./usage-provider"

export type UsageDisplayMode = "used" | "remaining"

export { resolveUsageProvider }
export type { UsageScope } from "./usage-provider"

type UsageConfig = {
  show_usage_value_mode?: UsageDisplayMode
}

export type UsageCommandResult =
  | {
      error: string
    }
  | {
      mode: UsageDisplayMode
      background: boolean
    }

export function parseUsageCommand(command: string, config?: UsageConfig): UsageCommandResult {
  const args = command.trim().split(/\s+/).slice(1)
  const provider = args.find((part) => !part.startsWith("-"))
  const hasAll = args.includes("--all")
  const hasCurrent = args.includes("--current")
  const hasUsed = args.includes("--used")
  const hasRemaining = args.includes("--remaining")
  const hasBackground = args.includes("--background")
  const supported = new Set(["--used", "--remaining", "--background"])
  const unsupported = args.find((part) => part.startsWith("-") && !supported.has(part))

  if (provider) {
    return {
      error: "Provider arguments are not supported. /usage always shows all providers.",
    }
  }

  if (hasAll || hasCurrent) {
    return {
      error: "Scope flags are not supported. /usage always shows all providers.",
    }
  }

  if (unsupported) {
    return {
      error: `Unknown usage option: ${unsupported}`,
    }
  }

  if (hasBackground && (hasUsed || hasRemaining)) {
    return {
      error: "--background cannot be combined with --used or --remaining.",
    }
  }

  if (hasUsed && hasRemaining) {
    return {
      error: "Choose only one of --used or --remaining.",
    }
  }

  return {
    mode: hasUsed ? "used" : hasRemaining ? "remaining" : (config?.show_usage_value_mode ?? "used"),
    background: hasBackground,
  }
}
