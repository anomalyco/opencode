import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { AppProcess } from "@opencode/util/process"
import { OpencodeMemoryAccess } from "@opencode/core/plugin/provider/opencode-memory-access"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("OpencodeMemoryAccess.secret", () => {
  test("names a prefix-anchored key format, never its value", () => {
    expect(OpencodeMemoryAccess.secret(`export GH=ghp_${"a".repeat(36)}`)).toBe("a GitHub token")
    expect(OpencodeMemoryAccess.secret("AKIAABCDEFGHIJKLMNOP is the key")).toBe("an AWS access key")
    expect(OpencodeMemoryAccess.secret(`sk-ant-api03-${"b".repeat(40)}`)).toBe("an Anthropic key")
    expect(OpencodeMemoryAccess.secret("-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).toBe("a private key")
    expect(OpencodeMemoryAccess.secret("Use the token from the vault, never paste one.")).toBeUndefined()
  })

  test("rejects literal credentials in command arguments, and lets references and placeholders through", () => {
    const secret = OpencodeMemoryAccess.secret
    expect(secret("PGPASSWORD=hunter2 psql -h db")).toBe("a password, secret or token assigned to a variable")
    expect(secret("PGPASSWORD=$PGPASSWORD psql -h db")).toBeUndefined()
    expect(secret("OPENAI_API_KEY=abc123 bun run eval")).toBe("a password, secret or token assigned to a variable")
    expect(
      secret('GH_TOKEN=${{ secrets.GH_TOKEN }} gh pr list, or NPM_TOKEN=<token>, or DB_PASSWORD=""'),
    ).toBeUndefined()
    // Only assignments count: a variable named in prose, or one merely ending in TOKEN_URL, doesn't.
    expect(secret("Set API_TOKEN in CI; TOKEN_URL=https://x.io/t is public")).toBeUndefined()
    expect(secret("psql --password=hunter2")).toBe("a password after --password=")
    expect(secret(`curl -H "Authorization: Basic dXNlcjpwdw==" https://api`)).toBe(
      "a credential in an Authorization header",
    )
    expect(secret(`hf_${"c".repeat(34)}`)).toBe("a Hugging Face token")
    expect(secret(`oc_sk_abcd1234_${"d".repeat(20)}`)).toBe("an OpenCode Console key")
    expect(secret("mysql -uroot -ps3cret app")).toBe("a password after mysql -p")
    expect(secret("mysql -u root -p app")).toBeUndefined()
    expect(secret("sshpass -p 'pw' ssh deploy@host")).toBe("a password after sshpass -p")
    expect(secret(`curl -H "Authorization: Bearer abc123" https://api`)).toBe("a credential in an Authorization header")
    expect(secret(`curl -H "Authorization: Bearer $TOKEN" https://api`)).toBeUndefined()
    expect(secret("DATABASE_URL=postgres://app:s3cret@db:5432/app")).toBe("a password in a URL")
    expect(secret("DATABASE_URL=postgres://app:${DB_PASSWORD}@db:5432/app")).toBeUndefined()
    expect(secret("postgres://app:<password>@db/app or https://github.com/acme/api")).toBeUndefined()
  })
})

describe("OpencodeMemoryAccess.share", () => {
  test("localizes every text but oldText, and names the first field with a secret", () => {
    const roots = { checkout: "/home/ada/src/api", home: "/home/ada" }
    expect(
      OpencodeMemoryAccess.share(
        {
          kind: "gotcha",
          paths: ["/home/ada/src/api/db/"],
          edits: [{ oldText: "/home/ada/src/api/x", newText: "/home/ada/src/api/y" }],
        },
        roots,
      ),
    ).toEqual({
      fields: { kind: "gotcha", paths: ["db/"], edits: [{ oldText: "/home/ada/src/api/x", newText: "y" }] },
    })
    expect(OpencodeMemoryAccess.share({ title: "ok", errors: ["fine", "mysql -uroot -ps3cret"] }, roots)).toEqual({
      field: "errors[1]",
      kind: "a password after mysql -p",
      repair: "Replace it with a variable reference such as $TOKEN or a placeholder such as <password>",
    })
    // Another account's home directory is left after localizing, and refused; the user's own becomes ~/.
    expect(OpencodeMemoryAccess.share({ body: "Logs in /home/ada/.cache and /home/bob/.cache" }, roots)).toMatchObject({
      field: "body",
      kind: "a path in a home directory",
    })
    expect(OpencodeMemoryAccess.share({ body: "Logs in /home/ada/.cache, not /root2 or /srv/root" }, roots)).toEqual({
      fields: { body: "Logs in ~/.cache, not /root2 or /srv/root" },
    })
  })
})

describe("OpencodeMemoryAccess.share, internal hosts", () => {
  test("refuses private addresses and internal-only host names, and keeps public ones and versions", () => {
    const share = (body: string) => OpencodeMemoryAccess.share({ body }, {})
    for (const body of [
      "psql -h 10.2.0.15 app",
      "curl http://192.168.1.20:8080",
      "ssh deploy@172.20.4.1",
      "vault-db.internal:5432",
      "build.corp/api",
    ])
      expect(share(body)).toMatchObject({ field: "body", kind: "an internal host name or address" })
    for (const body of [
      "curl http://localhost:3000 and 127.0.0.1",
      "https://api.github.com",
      "Windows 10.0.19041.1",
      "172.32.0.1 is public",
      "Bump to 1.10.2.3",
    ])
      expect(share(body)).toEqual({ fields: { body } })
  })
})

describe("OpencodeMemoryAccess.localize", () => {
  test("makes the checkout's paths relative and other home paths start at ~/", () => {
    const roots = { checkout: "/home/ada/src/api", home: "/home/ada" }
    expect(
      OpencodeMemoryAccess.localize(
        "Edit /home/ada/src/api/src/pricing.ts, run from /home/ada/src/api; logs in /home/ada/.cache/x.log",
        roots,
      ),
    ).toBe("Edit src/pricing.ts, run from .; logs in ~/.cache/x.log")
    expect(OpencodeMemoryAccess.localize("file:///home/ada/src/api/README.md", roots)).toBe("README.md")
    // A sibling whose name only starts like the checkout isn't inside it.
    expect(OpencodeMemoryAccess.localize("/home/ada/src/api-v2/x.ts", roots)).toBe("~/src/api-v2/x.ts")
  })
})

/** GitHub's repository routes, in-process: `repositories` by owner/name, `answers` by id for the reader's checks. */
function fakeGitHub() {
  const state = {
    repositories: new Map<string, { id: number; visibility: string; public: boolean }>(),
    answers: new Map<number, { status: number; headers?: Record<string, string> }>(),
    requests: new Array<{ path: string; authorization: string | null }>(),
  }
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      const authorization = request.headers.get("authorization")
      state.requests.push({ path: url.pathname, authorization })
      const byName = url.pathname.match(/^\/repos\/(.+)$/)?.[1]
      if (byName) {
        const repository = state.repositories.get(byName)
        if (!repository || (!repository.public && authorization !== "Bearer reader-token"))
          return new Response("{}", { status: 404 })
        return Response.json({ id: repository.id, visibility: repository.visibility })
      }
      const id = Number(url.pathname.match(/^\/repositories\/(\d+)$/)?.[1])
      const answer = state.answers.get(id) ?? { status: 404 }
      return answer.status === 200
        ? Response.json({ id, visibility: "private" })
        : new Response("{}", { status: answer.status, headers: answer.headers })
    },
  })
  return { server, state }
}

const withGitHub = <A, E, R>(use: (github: ReturnType<typeof fakeGitHub>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeGitHub), use, (github) => Effect.promise(() => github.server.stop(true)))

const access = (github: ReturnType<typeof fakeGitHub>) =>
  Effect.gen(function* () {
    return OpencodeMemoryAccess.make(yield* HttpClient.HttpClient, yield* AppProcess.Service, {
      api: github.server.url.origin,
      env: { GH_TOKEN: "reader-token" },
    })
  })

describe("OpencodeMemoryAccess.make", () => {
  it.effect(
    "anchors a public repository from an anonymous request, and a private one with the author's credential",
    () =>
      withGitHub((github) =>
        Effect.gen(function* () {
          github.state.repositories.set("acme/web", { id: 101, visibility: "public", public: true })
          github.state.repositories.set("acme/api", { id: 202, visibility: "private", public: false })
          const { anchor } = yield* access(github)

          expect(yield* anchor("github.com/acme/web")).toEqual({
            host: "github.com",
            name: "acme/web",
            repoId: 101,
            visibility: "public",
          })
          expect(github.state.requests).toEqual([{ path: "/repos/acme/web", authorization: null }])

          expect(yield* anchor("github.com/acme/api")).toEqual({
            host: "github.com",
            name: "acme/api",
            repoId: 202,
            visibility: "private",
          })
          expect(yield* anchor("github.com/acme/gone")).toEqual({
            host: "github.com",
            name: "acme/gone",
            visibility: "non-public",
          })
          expect(yield* anchor("gitlab.example.com/group/app")).toEqual({
            host: "gitlab.example.com",
            name: "group/app",
            visibility: "non-public",
          })
        }),
      ),
  )

  it.effect(
    "keeps the repositories the reader can read, and a readable one through an unknown answer only so long",
    () =>
      withGitHub((github) =>
        Effect.gen(function* () {
          const { reachable } = yield* access(github)
          github.state.answers.set(1, { status: 200 })
          github.state.answers.set(2, { status: 404 })
          github.state.answers.set(3, { status: 403, headers: { "x-github-sso": "required; url=https://x" } })
          github.state.answers.set(4, { status: 403, headers: { "x-ratelimit-remaining": "0" } })
          expect(yield* reachable([1, 2, 3, 4])).toEqual([1])
          expect(github.state.requests.every((request) => request.authorization === "Bearer reader-token")).toBe(true)

          // Within a minute nothing is asked again, a rate-limited repository included.
          const asked = github.state.requests.length
          expect(yield* reachable([1, 2, 3, 4])).toEqual([1])
          expect(github.state.requests.length).toBe(asked)

          // GitHub failing keeps a readable answer within its ten minutes, never longer, and never reading extends it.
          github.state.answers.set(1, { status: 502 })
          yield* TestClock.adjust("2 minutes")
          expect(yield* reachable([1])).toEqual([1])
          yield* TestClock.adjust("9 minutes")
          expect(yield* reachable([1])).toEqual([])

          // A refusal takes it out at once.
          github.state.answers.set(1, { status: 200 })
          yield* TestClock.adjust("2 minutes")
          expect(yield* reachable([1])).toEqual([1])
          github.state.answers.set(1, { status: 404 })
          yield* TestClock.adjust("2 minutes")
          expect(yield* reachable([1])).toEqual([])
        }),
      ),
  )
})
