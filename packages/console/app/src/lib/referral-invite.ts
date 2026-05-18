import { Referral } from "@opencode-ai/console-core/referral.js"

const INVITE_COOKIE = "oc_referral"
const INVITE_MAX_AGE = 60 * 60 * 24 * 30

export function normalizeInviteCode(code?: string | null) {
  return Referral.normalizeCode(code)
}

export function inviteCookie(code: string) {
  return `${INVITE_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${INVITE_MAX_AGE}; SameSite=Lax; HttpOnly`
}

export function clearInviteCookie() {
  return `${INVITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`
}

export function inviteFromCookieHeader(header: string | null) {
  if (!header) return undefined

  return normalizeInviteCode(
    header
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${INVITE_COOKIE}=`))
      ?.slice(`${INVITE_COOKIE}=`.length),
  )
}
