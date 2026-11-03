import { createStore } from "solid-js/store"
import { Option } from "effect"
import { decodeGitHubResponse, githubPreviewOf, githubRequestURL, type GitHubPreview, type GitHubTarget } from "./links"

// Loaded previews by link URL. A preview stays after it goes stale, so a revalidating or rate-limited link keeps its
// rich row instead of falling back to its caption.
const [previews, setPreviews] = createStore<Record<string, GitHubPreview>>({})

// When each link may be requested again: fresh metadata for five minutes, a missing or private link for a day, and a
// failed request after 30 seconds. A link is only requested again when its row renders, never by polling.
const nextRequest = new Map<string, number>()

const inflight = new Set<string>()

// Unauthenticated requests share GitHub's 60 an hour per IP. Once GitHub says they are spent, nothing is requested
// until its reset time.
let blockedUntil = 0

const fresh = 5 * 60_000

const missing = 24 * 60 * 60_000

const failed = 30_000

/** The GitHub metadata loaded for a link, reactively; undefined until it loads, or when it can't. */
export function githubPreview(link: GitHubTarget): GitHubPreview | undefined {
  return previews[link.url]
}

/**
 * Requests a link's metadata from GitHub's public REST API, without credentials or cookies, unless a fresh answer,
 * an earlier failure, or the rate limit says to wait.
 */
export function loadGitHubPreview(link: GitHubTarget) {
  const now = Date.now()

  if (inflight.has(link.url) || now < blockedUntil || now < (nextRequest.get(link.url) ?? 0)) return
  inflight.add(link.url)

  void fetch(githubRequestURL(link), {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(6_000),
  })
    .then(async (response) => {
      noteRateLimit(response)

      // A renamed repository redirects within the API; anything else is not an answer.
      if (!response.url.startsWith("https://api.github.com/")) return wait(link, failed)

      if (response.status === 404 || response.status === 410 || response.status === 451) return wait(link, missing)

      if (!response.ok) return wait(link, failed)

      const preview = Option.getOrUndefined(
        decodeGitHubResponse(await response.json()).pipe(Option.map((value) => githubPreviewOf(link, value))),
      )

      if (!preview) return wait(link, missing)
      setPreviews(link.url, preview)
      wait(link, fresh)
    })
    .catch(() => wait(link, failed))
    .finally(() => inflight.delete(link.url))
}

function wait(link: GitHubTarget, duration: number) {
  nextRequest.set(link.url, Date.now() + duration)
}

function noteRateLimit(response: Response) {
  if (response.headers.get("x-ratelimit-remaining") !== "0") return

  const reset = Number(response.headers.get("x-ratelimit-reset"))

  blockedUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60 * 60_000
}
