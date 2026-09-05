import { z } from "zod"

const ACTION = "legacy_console_auth"
const ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

const VerificationResponse = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
})

export type TurnstileProvider = "github" | "google"
type TurnstileFetch = (...input: Parameters<typeof fetch>) => ReturnType<typeof fetch>

export async function verifyTurnstile(
  input: {
    token: string
    secret: string
    hostname: string
    remoteIP?: string
  },
  fetcher: TurnstileFetch = fetch,
) {
  if (!input.token) return false
  return fetcher(ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      secret: input.secret,
      response: input.token,
      idempotency_key: crypto.randomUUID(),
      ...(input.remoteIP ? { remoteip: input.remoteIP } : {}),
    }),
    signal: AbortSignal.timeout(5_000),
  })
    .then(async (response) => {
      if (!response.ok) return false
      const result = VerificationResponse.safeParse(await response.json())
      if (!result.success) return false
      return result.data.success && result.data.action === ACTION && result.data.hostname === input.hostname
    })
    .catch(() => false)
}

export function getTurnstileProvider(pathname: string): TurnstileProvider | undefined {
  const provider = pathname.match(/^\/(github|google)\/authorize\/?$/)?.[1]
  if (provider === "github" || provider === "google") return provider
}

export function getTurnstileProviderRequest(request: Request, provider: TurnstileProvider) {
  const cookie = request.headers.get("Cookie")
  return new Request(new URL(`/${provider}/authorize`, request.url), {
    headers: cookie ? { Cookie: cookie } : undefined,
    method: "GET",
  })
}

export function renderTurnstilePage(
  siteKey: string,
  providers: TurnstileProvider[] = ["github", "google"],
  error?: string,
) {
  const buttons = providers
    .map(
      (provider) =>
        `<button type="submit" name="provider" value="${provider}" disabled>Continue with ${provider === "github" ? "GitHub" : "Google"}</button>`,
    )
    .join("")
  const message = error ? `<p role="alert">${escapeHTML(error)}</p>` : ""
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to OpenCode</title>
    <script>
      window.turnstileReady = function () {
        document.querySelectorAll("button").forEach(function (button) { button.disabled = false })
      }
      window.turnstileReset = function () {
        document.querySelectorAll("button").forEach(function (button) { button.disabled = true })
      }
    </script>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
    <style>
      :root { color-scheme: light dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: Canvas; color: CanvasText; }
      main { width: min(100% - 32px, 400px); border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 32px; }
      header { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
      img { width: 28px; height: 28px; }
      h1 { margin: 0; font: inherit; font-weight: 700; font-size: 18px; }
      form { display: grid; gap: 10px; }
      .turnstile { min-height: 1px; }
      button { min-height: 44px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); background: Canvas; color: CanvasText; font: inherit; font-weight: 600; cursor: pointer; }
      button:hover:not(:disabled) { background: color-mix(in srgb, CanvasText 7%, Canvas); }
      button:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
      button:disabled { cursor: wait; opacity: 0.5; }
      p { margin: 0 0 18px; color: #d33; font-size: 13px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <header><img src="https://opencode.ai/favicon-v3.svg" alt=""><h1>Sign in to OpenCode</h1></header>
      ${message}
      <form method="post" action="/turnstile">
        <div class="turnstile cf-turnstile" data-sitekey="${escapeHTML(siteKey)}" data-action="${ACTION}" data-appearance="interaction-only" data-size="flexible" data-theme="auto" data-callback="turnstileReady" data-error-callback="turnstileReset" data-expired-callback="turnstileReset" data-timeout-callback="turnstileReset"></div>
        ${buttons}
      </form>
    </main>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; connect-src https://challenges.cloudflare.com; form-action 'self'; frame-src https://challenges.cloudflare.com; img-src https://opencode.ai; script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
      status: error ? 400 : 200,
    },
  )
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;"
    if (character === "<") return "&lt;"
    if (character === ">") return "&gt;"
    if (character === '"') return "&quot;"
    return "&#039;"
  })
}
