import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

// Validate the `continue` query parameter is a safe relative path that will be
// appended after `/auth/callback`. This prevents open-redirect attacks
// (CWE-601) where an attacker crafts values like `//evil.com/x` or
// `/../something` that, after the OAuth round trip, would cause the callback
// handler to redirect the user off-site.
function safeContinue(value: string): string {
  if (!value) return ""
  // Must begin with `/` so the resulting path stays under `/auth/callback/...`.
  if (!value.startsWith("/")) return ""
  // Reject protocol-relative URLs (`//host`) and backslash variants which
  // some browsers normalise to `/`.
  if (value.startsWith("//") || value.startsWith("/\\") || value.startsWith("\\")) return ""
  // Reject any path traversal or embedded scheme/auth components.
  if (value.includes("..") || value.includes("\\") || /[\r\n\t]/.test(value)) return ""
  return value
}

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const cont = safeContinue(url.searchParams.get("continue") ?? "")
  const callbackUrl = new URL(`./callback${cont}`, input.request.url)
  const result = await AuthClient.authorize(callbackUrl.toString(), "code")
  return Response.redirect(result.url, 302)
}
