const INVITE_COOKIE = "opencode.go.invite"
const INVITE_MAX_AGE = 60 * 60 * 24 * 30

export function normalizeInviteCode(code?: string | null) {
  return code?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
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
