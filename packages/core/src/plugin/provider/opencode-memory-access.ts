export * as OpencodeMemoryAccess from "./opencode-memory-access.js"

import { Hash } from "@opencode/util/hash"
import type { AppProcess } from "@opencode/util/process"
import { Clock, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ChildProcess } from "effect/process"

/** How long a repository the reader could read counts as readable without asking GitHub again. Never extended by use. */
const REACHABLE_MAX_AGE = 10 * 60 * 1000
/** How long any answer is reused before GitHub is asked again. */
const RECHECK_AFTER = 60 * 1000
const CHECK_CONCURRENCY = 8

/**
 * A repository an entry is about, as its author's machine saw it at publish. `repoId` is GitHub's numeric id, which
 * stays the repository's through renames; `name` is for display. `public` comes from an anonymous request, so it means
 * anyone can read it; anything else is `non-public` unless the author's own credential says `private` or `internal`.
 */
export interface Anchor {
  readonly host: string
  readonly name: string
  readonly repoId?: number
  readonly visibility: "public" | "internal" | "private" | "non-public"
}

// Prefix-anchored key formats: rejected wherever they appear.
const FORMATS: ReadonlyArray<readonly [string, RegExp]> = [
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["a GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a Stripe key", /\b[rs]k_live_[0-9A-Za-z]{16,}/],
  ["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}/],
  ["a private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
]
// Credentials given as literal command arguments; the first group is the value, which may only be a reference.
const ARGUMENTS: ReadonlyArray<readonly [string, RegExp]> = [
  ["a password in PGPASSWORD=", /\bPGPASSWORD=([^\s;&|]+)/g],
  ["a password in MYSQL_PWD=", /\bMYSQL_PWD=([^\s;&|]+)/g],
  ["a password after mysql -p", /\b(?:mysql|mysqldump|mariadb|mysqladmin)\b[^\n|;&]*?\s-p(?!\s)([^\s;&|]+)/g],
  ["a password after sshpass -p", /\bsshpass\s+-p\s*([^\s;&|]+)/g],
  ["a bearer token in an Authorization header", /\bAuthorization:\s*Bearer\s+([^\s"'`\\]+)/gi],
  ["a password in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:([^\s/@'"`]+)@[^\s/'"`]/gi],
]
/** A variable reference or a placeholder, which stands for a credential without being one. */
const REFERENCE =
  /^["'`]?(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|<[^<>]+>|\{\{[^}]+\}\}|\*{3,}|\.{3}|…|x{3,}|X{3,})/

/** What in `text` may not reach the workspace's pool, by its kind and never its value, or undefined. */
export function secret(text: string): string | undefined {
  const format = FORMATS.find(([, pattern]) => pattern.test(text))
  if (format) return format[0]
  const argument = ARGUMENTS.find(([, pattern]) =>
    Array.from(text.matchAll(pattern), (match) => match[1] ?? "").some((value) => !REFERENCE.test(value)),
  )
  return argument?.[0]
}

/**
 * `text` with this machine's paths made shareable: inside the checkout, relative to its root; elsewhere under the home
 * directory, from `~/`, so no account name leaves the machine.
 */
export function localize(text: string, roots: { readonly checkout?: string; readonly home?: string }) {
  const replace = (from: string | undefined, to: string, input: string) =>
    from === undefined || from.length < 2
      ? input
      : input
          .replaceAll(`file://${from}/`, to)
          .replaceAll(`${from}/`, to)
          .replace(new RegExp(`${escape(from)}(?![\\w.-])`, "g"), to === "" ? "." : to.slice(0, -1))
  return replace(roots.home, "~/", replace(roots.checkout, "", text))
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const Repository = Schema.Struct({ id: Schema.Number, visibility: Schema.optional(Schema.String) })
/** GitHub's answer for one repository: its status, whether it was a rate limit, and the repository when readable. */
type Answer = { readonly status: number; readonly limited: boolean; readonly repository?: typeof Repository.Type }

/**
 * GitHub as this machine reaches it: the anchor of a repository its checkout names, from an anonymous request first,
 * and which of the repositories Console lists the reader can read, with the reader's own credential. Only numeric ids
 * leave the machine, and nothing computed with one credential is reused for another.
 */
export const make = (
  http: HttpClient.HttpClient,
  processes: AppProcess.Interface,
  options: { readonly api: string; readonly env: Readonly<Record<string, string | undefined>> },
) => {
  // Per credential and repository: when GitHub last said the reader can read it, if it did since, and when it was asked.
  const checked = new Map<string, { readonly readable: number | undefined; readonly asked: number }>()
  const fresh = (readable: number | undefined, now: number) =>
    readable !== undefined && now - readable < REACHABLE_MAX_AGE

  // The credential the agent's own `gh` uses; none when there's no way to ask GitHub as the reader.
  const token = Effect.gen(function* () {
    const fromEnv = options.env.GH_TOKEN || options.env.GITHUB_TOKEN
    if (fromEnv) return fromEnv
    const result = yield* processes.run(ChildProcess.make("gh", ["auth", "token"], { stdin: "ignore" }))
    const value = result.exitCode === 0 ? result.stdout.toString().trim() : ""
    return value === "" ? undefined : value
  }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

  const get = (path: string, credential?: string) =>
    HttpClient.withScope(http)
      .execute(
        HttpClientRequest.get(`${options.api}${path}`).pipe(
          HttpClientRequest.setHeaders({
            accept: "application/vnd.github+json",
            ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
          }),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? HttpClientResponse.schemaBodyJson(Repository)(response).pipe(
                Effect.map((repository): Answer => ({ status: 200, limited: false, repository })),
              )
            : Effect.succeed<Answer>({
                status: response.status,
                // GitHub's rate limits answer 403 or 429 with these headers; any other 403 is a refusal.
                limited:
                  response.status === 429 ||
                  response.headers["x-ratelimit-remaining"] === "0" ||
                  response.headers["retry-after"] !== undefined,
              }),
        ),
        Effect.scoped,
        Effect.timeout("10 seconds"),
        Effect.catchCause(() => Effect.succeed<Answer>({ status: 0, limited: false })),
      )

  /** The anchor of `name` (`host/owner/repo`), as the author's machine sees it now. */
  const anchor = Effect.fnUntraced(function* (name: string) {
    const [host, ...rest] = name.split("/")
    const path = rest.join("/")
    if (host !== "github.com" || rest.length !== 2)
      return { host: host ?? "", name: path, visibility: "non-public" } as Anchor
    const anonymous = yield* get(`/repos/${path}`)
    if (anonymous.repository)
      return { host, name: path, repoId: anonymous.repository.id, visibility: "public" } as Anchor
    const credential = yield* token
    const authenticated = credential === undefined ? undefined : (yield* get(`/repos/${path}`, credential)).repository
    const visibility = authenticated?.visibility
    return {
      host,
      name: path,
      ...(authenticated === undefined ? {} : { repoId: authenticated.id }),
      visibility: visibility === "private" || visibility === "internal" ? visibility : "non-public",
    } as Anchor
  })

  /**
   * Of `ids`, the repositories the reader's credential can read. A 404 or 403 is not readable; a rate limit, a server
   * error or no answer is unknown, which keeps a readable answer only within its fixed maximum age, otherwise leaves the
   * repository out.
   */
  const reachable = Effect.fnUntraced(function* (ids: ReadonlyArray<number>) {
    if (ids.length === 0) return []
    const credential = yield* token
    if (credential === undefined) return []
    const owner = Hash.sha256(credential).slice(0, 16)
    const now = yield* Clock.currentTimeMillis
    const verdicts = yield* Effect.forEach(
      ids,
      (id) =>
        Effect.gen(function* () {
          const key = `${owner}:github.com:${id}`
          const known = checked.get(key)
          if (known && now - known.asked < RECHECK_AFTER) return fresh(known.readable, now)
          const answer = yield* get(`/repositories/${id}`, credential)
          if (answer.status === 200) {
            checked.set(key, { readable: now, asked: now })
            return true
          }
          // 404: this credential can't read it. 403: SSO not authorized for it, an IP allow list, or a refusal.
          if (answer.status === 404 || (answer.status === 403 && !answer.limited)) {
            checked.set(key, { readable: undefined, asked: now })
            return false
          }
          // Unknown: not asked again for a minute, so a rate limit isn't hit on every search, and not confirmed either.
          checked.set(key, { readable: known?.readable, asked: now })
          return fresh(known?.readable, now)
        }),
      { concurrency: CHECK_CONCURRENCY },
    )
    return ids.filter((_, index) => verdicts[index])
  })

  return { anchor, reachable }
}
