import { Log } from "../util/log"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"

const log = Log.create({ service: "aws-refresh" })

type AwsCredentialProvider = () => Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}>

const REFRESH_TIMEOUT = 120000
const REFRESH_COOLDOWN = 60000

let refreshing: Promise<boolean> | null = null
let lastRefreshTime = 0

export enum AWSErrorType {
  EXPIRED_TOKEN = "expired_token",
  INVALID_CREDENTIALS = "invalid_credentials",
  MISSING_CREDENTIALS = "missing_credentials",
  PROFILE_NOT_FOUND = "profile_not_found",
  WEB_IDENTITY = "web_identity",
  ACCESS_DENIED = "access_denied",
  UNKNOWN = "unknown",
}

const ERROR_PATTERNS: {
  type: AWSErrorType
  patterns: string[]
  refreshable: boolean
}[] = [
  {
    type: AWSErrorType.EXPIRED_TOKEN,
    refreshable: true,
    patterns: [
      "Token is expired",
      "token is expired",
      "SSO session associated with this profile has expired",
      "SSO session token associated with",
      "was not found or is invalid",
      "security token included in the request is expired",
      "ExpiredToken",
      "expired security credentials",
      "The security token included in the request is expired",
    ],
  },
  {
    type: AWSErrorType.WEB_IDENTITY,
    refreshable: true,
    patterns: [
      "The web identity token that was passed is expired",
      "web identity token",
      "IDPCommunicationError",
      "IDPRejectedClaim",
      "InvalidIdentityToken",
    ],
  },
  {
    type: AWSErrorType.MISSING_CREDENTIALS,
    refreshable: false,
    patterns: [
      "Unable to resolve AWS access key id",
      "Unable to resolve AWS secret access key",
      "Could not load credentials from any providers",
      "No viable credential source",
      "AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not set",
      "The security token included in the request is invalid",
    ],
  },
  {
    type: AWSErrorType.PROFILE_NOT_FOUND,
    refreshable: false,
    patterns: [
      "could not be found",
      "Cannot find profile",
      "No credentials found for profile",
      "Unrecognized credential source for profile",
    ],
  },
  {
    type: AWSErrorType.INVALID_CREDENTIALS,
    refreshable: false,
    patterns: ["InvalidClientTokenId", "SignatureDoesNotMatch", "The X.509 certificate or AWS access key ID"],
  },
  {
    type: AWSErrorType.ACCESS_DENIED,
    refreshable: false,
    patterns: ["is not authorized to perform", "Not authorized to assume role", "AccessDenied"],
  },
]

export function classifyAWSError(error: unknown): { type: AWSErrorType; refreshable: boolean; message: string } {
  if (!error) {
    return { type: AWSErrorType.UNKNOWN, refreshable: false, message: "Unknown error" }
  }

  const msg = error instanceof Error ? error.message : String(error)

  for (const { type, patterns, refreshable } of ERROR_PATTERNS) {
    if (patterns.some((pattern) => msg.includes(pattern))) {
      return { type, refreshable, message: msg }
    }
  }

  return { type: AWSErrorType.UNKNOWN, refreshable: false, message: msg }
}

export function isAWSCredentialError(error: unknown): boolean {
  return classifyAWSError(error).refreshable
}

export function validateCommand(cmd: string): { valid: boolean; error?: string } {
  const trimmed = cmd.trim()

  if (!trimmed) {
    return { valid: false, error: "Command cannot be empty" }
  }

  if (trimmed.startsWith("aws ")) return { valid: true }

  if (trimmed.startsWith("/")) {
    log.warn("using absolute path", { command: trimmed })
    return { valid: true }
  }

  return { valid: false, error: "Command must start with 'aws' or be an absolute path" }
}

export function parseCommand(cmd: string): string[] {
  const args: string[] = []
  let current = ""
  let inQuote: string | null = null

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === " " && current) {
      args.push(current)
      current = ""
    } else if (char !== " ") {
      current += char
    }
  }

  if (current) args.push(current)
  return args
}

function showToast(message: string, variant: "info" | "success" | "warning" | "error", title?: string) {
  Bus.publish(TuiEvent.ToastShow, {
    message,
    variant,
    title,
    duration: variant === "error" ? 8000 : 5000,
  }).catch((e) => log.debug("failed to show toast", { error: e }))
}

export async function runAuthRefresh(command: string): Promise<boolean> {
  try {
    log.info("running auth refresh", { command })

    const validation = validateCommand(command)
    if (!validation.valid) {
      console.error(`Invalid command: ${validation.error}`)
      showToast(validation.error ?? "Invalid command", "error", "AWS Auth Refresh")
      return false
    }

    const argv = parseCommand(command)

    const isInteractive = process.stdin.isTTY && process.stdout.isTTY
    if (!isInteractive) {
      const msg =
        "AWS SSO login requires an interactive terminal. Please run 'opencode' in a terminal, or refresh credentials manually."
      log.warn("non-interactive environment detected")
      showToast(msg, "warning", "AWS Auth Refresh")
      console.warn(msg)
    }

    showToast("Refreshing AWS credentials...", "info", "AWS Auth Refresh")

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout after 2 minutes")), REFRESH_TIMEOUT)
    })

    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: isInteractive ? "inherit" : "ignore",
    })

    const exitCode = await Promise.race([proc.exited, timeout])

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    if (stdout) log.info("auth refresh stdout", { stdout: stdout.trim() })
    if (stderr) log.info("auth refresh stderr", { stderr: stderr.trim() })

    if (exitCode === 0) {
      log.info("auth refresh succeeded")
      showToast("AWS credentials refreshed successfully", "success", "AWS Auth Refresh")
      return true
    }

    log.error("auth refresh failed", { exitCode, stderr: stderr.trim() })
    showToast("AWS credential refresh failed. Check terminal for details.", "error", "AWS Auth Refresh")
    return false
  } catch (err) {
    log.error("refresh command failed", { command, err })
    console.error(`Failed to refresh: ${err}`)
    showToast(`Failed to refresh: ${err instanceof Error ? err.message : String(err)}`, "error", "AWS Auth Refresh")
    return false
  }
}

export function wrapCredentialProviderWithRefresh(
  provider: AwsCredentialProvider,
  refreshCmd?: string,
): AwsCredentialProvider {
  if (!refreshCmd) return provider

  return async () => {
    try {
      return await provider()
    } catch (err) {
      const classified = classifyAWSError(err)

      if (!classified.refreshable) {
        log.warn("non-refreshable credential error", {
          type: classified.type,
          message: classified.message,
        })
        throw err
      }

      log.info("credential expired, attempting refresh", { type: classified.type })

      const now = Date.now()
      if (now - lastRefreshTime < REFRESH_COOLDOWN) {
        log.warn("skipping refresh (cooldown)")
        showToast("Credentials expired. Please wait before refreshing again.", "warning", "AWS Auth Refresh")
        throw err
      }

      if (!refreshing) {
        refreshing = runAuthRefresh(refreshCmd)
      }

      try {
        const ok = await refreshing
        lastRefreshTime = Date.now()

        if (ok) {
          log.info("retrying after refresh")
          return await provider()
        }

        throw err
      } finally {
        refreshing = null
      }
    }
  }
}

export function wrapBearerTokenWithRefresh(
  getToken: () => Promise<string | undefined>,
  refreshCmd?: string,
): () => Promise<string | undefined> {
  if (!refreshCmd) return getToken

  return async () => {
    try {
      const token = await getToken()
      if (!token) {
        throw new Error("No bearer token available")
      }
      return token
    } catch (err) {
      const classified = classifyAWSError(err)

      if (!classified.refreshable) {
        log.warn("non-refreshable bearer token error", {
          type: classified.type,
          message: classified.message,
        })
        throw err
      }

      log.info("bearer token expired, attempting refresh")

      const now = Date.now()
      if (now - lastRefreshTime < REFRESH_COOLDOWN) {
        log.warn("skipping refresh (cooldown)")
        throw err
      }

      if (!refreshing) {
        refreshing = runAuthRefresh(refreshCmd)
      }

      try {
        const ok = await refreshing
        lastRefreshTime = Date.now()

        if (ok) {
          log.info("retrying after refresh")
          return await getToken()
        }

        throw err
      } finally {
        refreshing = null
      }
    }
  }
}
