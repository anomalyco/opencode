import { Resource } from "@opencode/console-resource"

const TIMEOUT_MS = 3000
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "sitekey-secret-mismatch"])

// Returns undefined when hCaptcha is unreachable so the caller can fail open.
export async function verifyHcaptcha(
  token: string,
  options: {
    fetch?: (request: Request) => Promise<Response>
    secret?: string
    remoteip?: string
    timeoutMs?: number
  } = {},
): Promise<boolean | undefined> {
  try {
    const body = new URLSearchParams({ secret: options.secret ?? Resource.HCAPTCHA_SECRET_KEY.value, response: token })
    if (options.remoteip) body.set("remoteip", options.remoteip)
    const response = await (options.fetch ?? fetch)(
      new Request("https://api.hcaptcha.com/siteverify", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      }),
    )
    if (!response.ok) {
      console.error("hCaptcha verification failed:", response.status)
      return undefined
    }
    const data = (await response.json()) as { success?: unknown; "error-codes"?: unknown }
    if (data.success === true) return true
    const errors = Array.isArray(data["error-codes"]) ? data["error-codes"] : []
    // A broken secret or site key is our misconfiguration, not a bot, so it fails open too.
    if (errors.some((code) => CONFIG_ERRORS.has(code))) {
      console.error("hCaptcha is misconfigured:", errors)
      return undefined
    }
    console.warn("hCaptcha rejected token", { errors })
    return false
  } catch (error) {
    console.error("hCaptcha verification unavailable:", error instanceof Error ? error.name : "unknown")
    return undefined
  }
}
