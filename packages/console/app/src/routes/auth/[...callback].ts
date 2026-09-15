import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"
import { useAuthSession } from "~/context/auth"
import { i18n } from "~/i18n"
import { localeFromRequest, route } from "~/lib/language"
import { resolveOAuthCallback } from "~/lib/oauth-callback"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const locale = localeFromRequest(input.request)
  const dict = i18n(locale)

  const outcome = resolveOAuthCallback(url.searchParams, dict)
  if (outcome.type === "denied") {
    const next = url.pathname === "/auth/callback" ? "/auth" : url.pathname.replace("/auth/callback", "")
    return redirect(route(locale, next))
  }
  if (outcome.type === "error") {
    return new Response(JSON.stringify({ error: outcome.message }), { status: 400 })
  }

  try {
    const code = url.searchParams.get("code") ?? ""
    const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
    if (result.err) throw new Error(result.err.message)
    const decoded = AuthClient.decode(result.tokens.access, {} as any)
    if (decoded.err) throw new Error(decoded.err.message)
    const session = await useAuthSession()
    const id = decoded.subject.properties.accountID
    await session.update((value) => {
      return {
        ...value,
        account: {
          ...value.account,
          [id]: {
            id,
            email: decoded.subject.properties.email,
          },
        },
        current: id,
      }
    })
    const next = url.pathname === "/auth/callback" ? "/auth" : url.pathname.replace("/auth/callback", "")
    return redirect(route(locale, next))
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: e.message,
      }),
      { status: 500 },
    )
  }
}
