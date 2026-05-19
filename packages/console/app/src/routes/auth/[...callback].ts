import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { Referral } from "@opencode-ai/console-core/referral.js"
import { AuthClient } from "~/context/auth"
import { useAuthSession } from "~/context/auth"
import { i18n } from "~/i18n"
import { localeFromRequest, route } from "~/lib/language"
import { clearReferralCookie, referralCodeFromCookieHeader } from "~/lib/referral-invite"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const locale = localeFromRequest(input.request)
  const dict = i18n(locale)

  try {
    const code = url.searchParams.get("code")
    if (!code) throw new Error(dict["auth.callback.error.codeMissing"])
    const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
    if (result.err) throw new Error(result.err.message)
    const decoded = AuthClient.decode(result.tokens.access, {} as any)
    if (decoded.err) throw new Error(decoded.err.message)
    const referralCode = referralCodeFromCookieHeader(input.request.headers.get("cookie"))
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
    if (decoded.subject.properties.newAccount && referralCode) {
      await Referral.createFromAccount({ accountID: id, referralCode }).catch((error) => {
        console.error("Referral create failed", error)
      })
    }
    const next = url.pathname === "/auth/callback" ? "/auth" : url.pathname.replace("/auth/callback", "")
    const response = redirect(route(locale, next))
    if (referralCode) response.headers.append("set-cookie", clearReferralCookie())
    return response
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: e.message,
        cause: Object.fromEntries(url.searchParams.entries()),
      }),
      { status: 500 },
    )
  }
}
