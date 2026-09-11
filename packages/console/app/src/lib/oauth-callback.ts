import type { Dict } from "~/i18n"

export type OAuthCallbackOutcome =
  | { type: "success" }
  | { type: "denied" }
  | { type: "error"; message: string }

export function resolveOAuthCallback(searchParams: URLSearchParams, dict: Dict): OAuthCallbackOutcome {
  const error = searchParams.get("error")
  if (error === "access_denied") return { type: "denied" }
  if (error) {
    const detail = searchParams.get("error_description") ?? error
    return { type: "error", message: `${dict["auth.callback.error.oauth"]} ${detail}` }
  }
  if (!searchParams.get("code")) {
    return { type: "error", message: dict["auth.callback.error.codeMissing"] }
  }
  return { type: "success" }
}
