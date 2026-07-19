import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

// Only allow `continue` values that are safe relative sub-paths appended to
// `/auth/callback`. This prevents open-redirect / path-traversal style abuse
// where a caller supplies e.g. `//evil.com`, `/../../evil`, or a value
// containing a scheme, so that the resulting callback URL remains under the
// `/auth/callback` prefix on the same origin.
function safeContinue(cont: string): string {
  if (!cont) return ""
  // Must start with '/' and must not be a protocol-relative URL ('//...').
  if (!cont.startsWith("/") || cont.startsWith("//")) return ""
  // Reject backslashes (some parsers treat them like '/') and control chars.
  if (/[\\\x00-\x1f]/.test(cont)) return ""
  // Reject any path traversal segments.
  const pathPart = cont.split(/[?#]/, 1)[0]
  if (pathPart.split("/").some((seg) => seg === "..")) return ""
  return cont
}

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const cont = safeContinue(url.searchParams.get("continue") ?? "")
  const callbackUrl = new URL(`./callback${cont}`, input.request.url)
  // Defence in depth: ensure the resolved callback URL is still under the
  // expected `/auth/callback` path on the same origin as the incoming request.
  if (
    callbackUrl.origin !== url.origin ||
    !callbackUrl.pathname.startsWith("/auth/callback")
  ) {
    return new Response("invalid continue parameter", { status: 400 })
  }
  const result = await AuthClient.authorize(callbackUrl.toString(), "code")
  return Response.redirect(result.url, 302)
}
