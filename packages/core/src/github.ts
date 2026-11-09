export * as Github from "./github.js"

import { Context, Effect, Layer, Ref, Schema } from "effect"
import { makeLocationNode } from "@Mackery6969/util/effect/app-node"
import { Credential } from "./credential.js"
import { Git } from "./git.js"
import { Integration } from "./integration.js"
import { Location } from "./location.js"
import { PRInfo as PRInfoSchema, PRReference as PRReferenceSchema } from "@Mackery6969/schema/github"

export const PRInfo = PRInfoSchema
export type PRInfo = typeof PRInfo.Type
export const PRReference = PRReferenceSchema
export type PRReference = typeof PRReference.Type

export class Service extends Context.Service<Service, Interface>()("@Mackery6969/Github") {}

export interface Interface {
  /** Whether a GitHub credential is available. */
  readonly authenticated: boolean
  /** The GitHub API base URL, or undefined when not authenticated. */
  readonly baseURL: string | undefined
  /** Parse a git remote URL into { owner, repo }. */
  readonly parseRemote: (url: string) => { owner: string; repo: string } | undefined
  /** Get the GitHub owner/repo from the current repository's origin remote. */
  readonly repository: () => Effect.Effect<{ owner: string; repo: string }, unknown>
  /** Get PR info by number, with aggressive in-process caching. */
  readonly prInfo: (input: { owner: string; repo: string; number: number }) => Effect.Effect<PRInfo, unknown>
  /** List open PRs, optionally filtered by head branch. */
  readonly listOpenPrs: (input: { owner: string; repo: string; head?: string }) => Effect.Effect<readonly PRInfo[], unknown>
  /** Detect the open PR for the current branch, if any. */
  readonly detectPr: () => Effect.Effect<PRReference | undefined, unknown>
  /** Create a PR for the current branch. */
  readonly createPr: (input: { title: string; body?: string; draft?: boolean }) => Effect.Effect<PRInfo, unknown>
  /**
   * Invalidate cached data. Call when external state changes
   * (pr_monitor webhook, branch switch, etc.).
   */
  readonly invalidateCache: () => void
}

function parseRemoteUrl(url: string): { owner: string; repo: string } | undefined {
  const sshMatch = /^github\.com[:/](.+?)\/(.+?)(?:\.git)?$/.exec(url)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }
  const httpsMatch = /^https:\/\/github\.com\/(.+?)\/(.+?)(?:\.git)?$/.exec(url)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }
  return undefined
}

/** Parse a git remote URL into { owner, repo }. Used by MCP gating. */
export const parseRemote = parseRemoteUrl

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const git = yield* Git.Service
    const credentials = yield* Credential.Service

    // Credentials
    const oauthCredentials = yield* credentials.list(Integration.ID.make("github-copilot"))
    const activeCredential = oauthCredentials.at(0)
    const authenticated = activeCredential !== undefined && activeCredential.value.type === "oauth"
    const oauthMetadata: Record<string, unknown> | undefined = activeCredential?.value.type === "oauth"
      ? activeCredential.value.metadata as Record<string, unknown>
      : undefined
    const apiEndpoint: string | undefined = typeof oauthMetadata?.apiEndpoint === "string"
      ? oauthMetadata.apiEndpoint
      : undefined
    const baseURL = apiEndpoint
      ? apiEndpoint.replace(/\/+$/, "")
      : (() => {
          const enterprise = typeof oauthMetadata?.enterpriseUrl === "string"
            ? oauthMetadata.enterpriseUrl
            : undefined
          return enterprise ? `https://api.${enterprise}` : "https://api.github.com"
        })()
    const token = activeCredential?.value.type === "oauth" ? activeCredential.value.access : undefined

    // --- In-process caches ---
    const repoCache = yield* Ref.make<{ owner: string; repo: string } | undefined>(undefined)
    const gitRepoCache = yield* Ref.make<Git.Repository | undefined>(undefined)
    const prInfoCache = yield* Ref.make<PrInfoCache>(new Map())
    const prsCache = yield* Ref.make<PrsCache>(new Map())

    // Local functions capture location, git, and cache Refs
    const resolveRepo = () =>
      Effect.gen(function* () {
        // Cached owner/repo
        const cached = yield* Ref.get(repoCache)
        if (cached) return cached
        // Cached Repository
        const gitRepo = yield* Ref.get(gitRepoCache)
        if (gitRepo) {
          const url = yield* git.remote.get(gitRepo, "origin")
          if (!url) return yield* Effect.fail(new Error("No origin remote configured"))
          const parsed = parseRemoteUrl(url)
          if (!parsed) return yield* Effect.fail(new Error(`Cannot parse remote URL: ${url}`))
          yield* Ref.set(repoCache, parsed)
          return parsed
        }
        // Discover
        const discovered = yield* git.repo.discover(location.directory)
        if (!discovered) return yield* Effect.fail(new Error("Not a git repository"))
        const url = yield* git.remote.get(discovered, "origin")
        if (!url) return yield* Effect.fail(new Error("No origin remote configured"))
        const parsed = parseRemoteUrl(url)
        if (!parsed) return yield* Effect.fail(new Error(`Cannot parse remote URL: ${url}`))
        yield* Ref.set(repoCache, parsed)
        yield* Ref.set(gitRepoCache, discovered)
        return parsed
      })

    const getGitRepo = () =>
      Effect.gen(function* () {
        let repo = yield* Ref.get(gitRepoCache)
        if (repo) return repo
        const discovered = yield* git.repo.discover(location.directory)
        if (!discovered) return yield* Effect.fail(new Error("Not a git repository"))
        yield* Ref.set(gitRepoCache, discovered)
        return discovered
      })

    const getPrInfo = (owner: string, repo: string, number: number) =>
      Effect.gen(function* () {
        const key = `${owner}/${repo}/${number}`
        const map = yield* Ref.get(prInfoCache)
        const cached = map.get(key)
        if (cached) return cached
        if (!token) return yield* Effect.fail(new Error("Not authenticated with GitHub"))
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const res = await fetch(`${baseURL}/repos/${owner}/${repo}/pulls/${number}`, {
              signal,
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            })
            if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
            return res.json() as Promise<unknown>
          },
          catch: (cause) => cause,
        })
        const info = Schema.decodeUnknownSync(PRInfo)(response)
        const next = new Map(map)
        next.set(key, info)
        yield* Ref.set(prInfoCache, next)
        return info
      })

    const listOpenPrsInternal = (owner: string, repo: string, head?: string) =>
      Effect.gen(function* () {
        const key = `${owner}/${repo}`
        const map = yield* Ref.get(prsCache)
        const cached = map.get(key)
        if (cached) return cached
        if (!token) return yield* Effect.fail(new Error("Not authenticated with GitHub"))
        const params = new URLSearchParams({ state: "open", per_page: "100" })
        if (head) params.set("head", head)
        const response = yield* Effect.tryPromise({
          try: async (signal) => {
            const res = await fetch(`${baseURL}/repos/${owner}/${repo}/pulls?${params.toString()}`, {
              signal,
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            })
            if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
            return res.json() as Promise<unknown>
          },
          catch: (cause) => cause,
        })
        const prs = Schema.decodeUnknownSync(Schema.Array(PRInfo))(response)
        const next = new Map(map)
        next.set(key, prs)
        yield* Ref.set(prsCache, next)
        return prs
      })

    return Service.of({
      authenticated,
      baseURL,
      parseRemote: parseRemoteUrl,
      repository: () => resolveRepo(),
      prInfo: (input) => getPrInfo(input.owner, input.repo, input.number),
      listOpenPrs: (input) => listOpenPrsInternal(input.owner, input.repo, input.head),
      detectPr: () =>
        Effect.gen(function* () {
          const repoInfo = yield* resolveRepo()
          const gitRepo = yield* getGitRepo()
          const branch = yield* git.history.branch(gitRepo)
          if (!branch) return undefined
          const prs = yield* listOpenPrsInternal(repoInfo.owner, repoInfo.repo)
          const match = prs.find(
            (pr) => pr.head.ref === branch || pr.head.ref === `${repoInfo.owner}:${branch}`,
          )
          return match
            ? { owner: repoInfo.owner, repo: repoInfo.repo, number: match.number }
            : undefined
        }),
      createPr: (input) =>
        Effect.gen(function* () {
          const repoInfo = yield* resolveRepo()
          const gitRepo = yield* getGitRepo()
          const branch = yield* git.history.branch(gitRepo)
          if (!branch) return yield* Effect.fail(new Error("No current branch"))
          const base = yield* git.history.defaultRemoteBranch(gitRepo, "origin")
          yield* Ref.set(prsCache, new Map())
          if (!token) return yield* Effect.fail(new Error("Not authenticated with GitHub"))
          const response = yield* Effect.tryPromise({
            try: async (signal) => {
              const res = await fetch(`${baseURL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
                method: "POST",
                signal,
                body: JSON.stringify({
                  title: input.title,
                  ...(input.body ? { body: input.body } : {}),
                  draft: input.draft ?? false,
                  head: branch,
                  base: base,
                }),
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                },
              })
              if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
              return res.json() as Promise<unknown>
            },
            catch: (cause) => cause,
          })
          return Schema.decodeUnknownSync(PRInfo)(response)
        }),
      invalidateCache: () =>
        Effect.gen(function* () {
          yield* Ref.set(repoCache, undefined)
          yield* Ref.set(gitRepoCache, undefined)
          yield* Ref.set(prInfoCache, new Map())
          yield* Ref.set(prsCache, new Map())
        }),
    })
  }).pipe(Effect.scoped),
)

type PrInfoCache = Map<string, PRInfo>
type PrsCache = Map<string, readonly PRInfo[]>

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Git.node, Credential.node],
})
