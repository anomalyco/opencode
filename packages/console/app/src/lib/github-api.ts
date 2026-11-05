import { config } from "~/config"
import { githubAppToken } from "~/lib/github-app"
import { readStored, writeStored } from "~/lib/edge-cache"

// Server-side GitHub API calls for the site (repo numbers, contributors, releases). Without a token
// GitHub allows 60 calls an hour per IP, which a dev machine can use up; a token allows 5,000. The
// token is, in order: an installation token for the OpenCode GitHub App when GITHUB_APP_ID and
// GITHUB_APP_PRIVATE_KEY are linked to this Worker (infra/console.ts), else GITHUB_TOKEN, else none.
// For local dev: `GITHUB_TOKEN=$(gh auth token) bun run dev`.

const personalToken = typeof process === "undefined" ? undefined : process.env.GITHUB_TOKEN
const repo = config.github.repoUrl.replace("https://github.com/", "")
// Installation tokens last an hour; one is reused for 50 minutes, from memory or from Cloudflare's
// cache at this location, so a new isolate doesn't sign in again.
const appTokenFor = 50 * 60_000
const app: { token?: string; until: number; failed: number; pending?: Promise<string | undefined> } = {
  until: 0,
  failed: 0,
}

/** A GitHub API response, or undefined when the call failed or timed out. */
export async function githubFetch(url: string, init?: RequestInit) {
  const token = (await appToken()) ?? personalToken
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenCode-Console",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined)
}

async function appToken() {
  if (app.token && Date.now() < app.until) return app.token
  const credentials = await appCredentials()
  // After a failed sign-in, a minute on GITHUB_TOKEN (or none) before trying again.
  if (!credentials || Date.now() - app.failed < 60_000) return
  app.pending ??= (async () => {
    const stored = await readStored<string>("github/app-token")
    if (stored && Date.now() - stored.time < appTokenFor) return remember(stored.value, stored.time)
    const fresh = await githubAppToken(credentials.id, credentials.key, repo)
    if (!fresh) {
      app.failed = Date.now()
      return
    }
    // GitHub's tokens last an hour, so 50 minutes stays well inside; a shorter one counts from its expiry.
    const time = Math.min(Date.now(), fresh.expires - 60_000 - appTokenFor)
    await writeStored("github/app-token", { time, value: fresh.token }, appTokenFor / 1000)
    return remember(fresh.token, time)
  })().finally(() => (app.pending = undefined))
  return app.pending
}

function remember(token: string, time: number) {
  app.token = token
  app.until = time + appTokenFor
  return token
}

/** The GitHub App's id and private key when both secrets are linked to this Worker, else undefined. */
async function appCredentials() {
  const id = await linked("GITHUB_APP_ID")
  const key = await linked("GITHUB_APP_PRIVATE_KEY")
  if (!id || !key) return
  return { id, key }
}

// SST's Resource throws for a secret that isn't linked, and that is the normal case here until
// infra links them, so the throw means "not linked".
// Imported here, not at the top: this module also reaches the browser bundle (through lib/github.ts),
// and SST's Resource reads process.env as it loads, which threw "process is not defined" there and
// stopped every page's script (5 Nov).
async function linked(name: string) {
  const { linkedSecret } = await import("~/lib/linked-secret").catch(() => ({ linkedSecret: () => undefined }))
  return linkedSecret(name)
}

/** The parsed JSON of a successful GitHub API response, or undefined. */
export async function githubJson(url: string) {
  const response = await githubFetch(url)
  if (!response?.ok) return undefined
  return response.json().catch(() => undefined)
}

/**
 * The last good GitHub data on disk, in dev only, so a dev server restart while the API is rate
 * limited still has something to show. Production keeps it in memory (and at the edge).
 */
export const githubDevCache = {
  async read<T>(key: string): Promise<T | undefined> {
    if (!import.meta.env.DEV) return undefined
    const { readFile } = await import("node:fs/promises")
    return readFile(await cachePath(key), "utf8")
      .then((text) => JSON.parse(text) as T)
      .catch(() => undefined)
  },
  async write(key: string, value: unknown) {
    if (!import.meta.env.DEV) return
    const { mkdir, writeFile } = await import("node:fs/promises")
    const path = await cachePath(key)
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true })
    await writeFile(path, JSON.stringify(value)).catch(() => {})
  },
}

async function cachePath(key: string) {
  const { tmpdir } = await import("node:os")
  return `${tmpdir()}/opencode-site-github/${key}.json`
}
