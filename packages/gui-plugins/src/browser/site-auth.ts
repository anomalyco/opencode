// Which HTTP authentication challenges the pane asks the user about, following Chrome's rules against phishing: a site
// may ask for the page the user opens and for its own resources, never for another origin's resource embedded in it.

/** Sign-in prompts the pane shows for one site and scheme in a visit before it lets the site's refusal show. */
export const MAX_SIGN_IN_ATTEMPTS = 3

const schemes = ["basic", "digest", "ntlm", "negotiate"]

export type Challenge = {
  /** The challenged request's address. */
  readonly url: string
  readonly isProxy: boolean
  readonly scheme: string
  readonly realm: string
  /** Electron's `firstAuthAttempt`: false when the site refused the last answer. */
  readonly first: boolean
}

export type ChallengeContext = {
  /** The tab's committed top-level origin. */
  readonly top: string
  /** The address of the top-level navigation in progress, after its redirects; a challenge for it is the page opened. */
  readonly pending?: string
  /** Prompts so far in this visit for this site and scheme (`challengeKey`). */
  readonly attempts: number
  /** The user dismissed this site's sign-in in this visit. */
  readonly dismissed?: boolean
}

/**
 * One site's sign-ins in a visit, whatever realm it names: a site that changes its realm on each challenge still
 * counts against one limit.
 */
export function challengeKey(origin: string, scheme: string) {
  return `${origin}\n${scheme.toLowerCase()}`
}

/**
 * What to do with a challenge: `proxy` leaves it to the proxy's own handler, `cancel` lets the site's refusal show,
 * and `prompt` asks the user, with the attempt it is. A fresh request does not start the count again, so a page's fetch
 * loop is bounded too, and a site the user dismissed does not ask again in the visit.
 */
export function challengeAnswer(challenge: Challenge, context: ChallengeContext) {
  if (challenge.isProxy) return { type: "proxy" } as const

  if (!schemes.includes(challenge.scheme.toLowerCase()) || !URL.canParse(challenge.url)) return { type: "cancel" } as const
  const url = new URL(challenge.url)

  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return { type: "cancel" } as const
  const pending = context.pending && URL.canParse(context.pending) ? new URL(context.pending).origin : undefined

  if ((url.origin !== context.top && url.origin !== pending) || context.dismissed) return { type: "cancel" } as const
  const attempt = context.attempts + 1

  if (attempt > MAX_SIGN_IN_ATTEMPTS) return { type: "cancel" } as const

  return { type: "prompt", attempt, key: challengeKey(url.origin, challenge.scheme) } as const
}
