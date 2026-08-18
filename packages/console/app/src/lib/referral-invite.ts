import { Actor } from "@opencode-ai/console-core/actor.js"
import { Referral } from "@opencode-ai/console-core/referral.js"
import { getRequestEvent } from "solid-js/web"

const REFERRAL_COOKIE = "oc_referral"
const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30

export function normalizeReferralCode(code?: string | null) {
  return Referral.normalizeCode(code)
}

export function referralCookie(code: string) {
  return `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${REFERRAL_MAX_AGE}; SameSite=Lax; HttpOnly`
}

export function clearReferralCookie() {
  return `${REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`
}

export function referralCodeFromCookieHeader(header: string | null) {
  if (!header) return undefined

  return normalizeReferralCode(
    header
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${REFERRAL_COOKIE}=`))
      ?.slice(`${REFERRAL_COOKIE}=`.length),
  )
}

export async function createReferralFromCookie() {
  const event = getRequestEvent()
  const referralCode = referralCodeFromCookieHeader(event?.request.headers.get("cookie") ?? null)
  if (!referralCode) return

  await Referral.createFromAccount({
    accountID: Actor.account(),
    referralCode,
  }).catch((error) => {
    console.error("Referral create failed", error)
  })
  event?.response.headers.append("set-cookie", clearReferralCookie())
}
