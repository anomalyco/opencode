import { Log } from "../util/log"

const log = Log.create({ service: "aws-refresh" })

type AwsCredentialProvider = () => Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}>

const REFRESH_TIMEOUT = 120000 // 2 minutes
const REFRESH_COOLDOWN = 60000 // 1 minute

let refreshing: Promise<boolean> | null = null
let lastRefreshTime = 0

export function isAWSCredentialError(error: unknown): boolean {
  if (!error) return false

  const msg = error instanceof Error ? error.message : String(error)

  const expiredPatterns = [
    "Token is expired",
    "token is expired",
    "SSO session associated with this profile has expired",
    "security token included in the request is expired",
    "ExpiredToken",
    "expired security credentials",
  ]

  return expiredPatterns.some((pattern) => msg.includes(pattern))
}

function validateCommand(cmd: string): boolean {
  const trimmed = cmd.trim()

  if (trimmed.startsWith("aws ")) return true

  if (trimmed.startsWith("/")) {
    log.warn("using absolute path", { command: trimmed })
    return true
  }

  log.error("invalid command", { command: trimmed })
  return false
}

function parseCommand(cmd: string): string[] {
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

export async function runAuthRefresh(command: string): Promise<boolean> {
  try {
    log.info("running auth refresh", { command })

    if (!validateCommand(command)) {
      console.error(`Invalid command: must start with 'aws' or be absolute path`)
      return false
    }

    const argv = parseCommand(command)

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout after 2 minutes")), REFRESH_TIMEOUT)
    })

    const proc = Bun.spawn(argv, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const exitCode = await Promise.race([proc.exited, timeout])

    if (exitCode === 0) {
      log.info("auth refresh succeeded")
      console.log(`AWS auth refreshed`)
      return true
    }

    log.error("auth refresh failed", { exitCode })
    console.error(`Auth refresh failed (exit ${exitCode})`)
    return false
  } catch (err) {
    log.error("refresh command failed", { command, err })
    console.error(`Failed to refresh: ${err}`)
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
      if (!isAWSCredentialError(err)) throw err

      log.info("credential expired, attempting refresh")

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
          return await provider()
        }

        throw err
      } finally {
        refreshing = null
      }
    }
  }
}
