import { describe, expect } from "bun:test"
import { statSync } from "node:fs"
import { ConsoleCredentials } from "@opencode/client-core/credentials"
import { ConnectStore } from "@opencode/client-core/store"
import { WorkspaceSnapshot } from "@opencode/client-core/snapshot"
import { Effect, Fiber } from "effect"
import { it } from "../../core/test/lib/effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { withEnv } from "../../core/test/fixture/env"
import { fakeConsole, server, signIn, until } from "./fixture/console"

const store = tmpdirScoped("opencode-connect-test-").pipe(Effect.map((dir) => ConnectStore.make(dir.path)))
const save = (target: ConnectStore.Info, credential: ReturnType<typeof signIn>) =>
  ConnectStore.write(ConnectStore.credentialFile(target), JSON.stringify(credential))

describe("ConsoleCredentials", () => {
  it.live("signs in with the device flow as its own client, scoped to a workspace", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      const shown: string[] = []
      const credential = yield* ConsoleCredentials.login(target, console.http, {
        server,
        prompt: (device) => Effect.sync(() => shown.push(`${device.url} ${device.code}`)),
      })

      expect(shown).toEqual([`${server}/device?user_code=ABCD-EFGH ABCD-EFGH`])
      const start = console.state.requests.find((request) => request.url.endsWith("/auth/device/code"))
      expect(yield* Effect.promise(() => start!.json())).toEqual({
        client_id: "opencode-connect",
        supports_org_scope: true,
      })
      expect(credential.metadata).toEqual({
        server,
        accountID: "usr_ada",
        email: "ada@example.com",
        orgID: "org_acme",
        orgName: "Acme",
      })
      expect(ConsoleCredentials.stored(target)).toEqual(credential)
      // Readable only by this user, like OpenCode's credential database.
      expect(statSync(ConnectStore.credentialFile(target)).mode & 0o777).toBe(0o600)
    }),
  )

  it.live("revokes the sign-in it replaces, keeping the config only for the same workspace", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      const snapshot = { owner: "acme", fetched: Date.now(), config: {} }
      save(target, { ...signIn(console.state, Date.now() + 3_600_000), refresh: "refresh-old" })
      WorkspaceSnapshot.write(target, snapshot)

      yield* ConsoleCredentials.login(target, console.http, { server, prompt: () => Effect.void })
      expect(console.state.revoked).toEqual(["refresh-old"])
      // Same member and workspace: its policies hold until the next fetch.
      expect(WorkspaceSnapshot.read(target)).toEqual(snapshot)

      const other = signIn(console.state, Date.now() + 3_600_000)
      save(target, { ...other, metadata: { ...other.metadata, orgID: "org_other", orgName: "Other" } })
      yield* ConsoleCredentials.login(target, console.http, { server, prompt: () => Effect.void })
      expect(WorkspaceSnapshot.read(target)).toBeUndefined()
    }),
  )

  it.live("refreshes once when many callers find the token expiring at the same time", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      save(target, signIn(console.state, Date.now() + 30_000))

      const results = yield* Effect.all(
        Array.from({ length: 10 }, () => ConsoleCredentials.fresh(target, console.http)),
        { concurrency: "unbounded" },
      )

      expect(console.state.refreshes).toBe(1)
      expect(new Set(results.map((credential) => credential?.type === "oauth" && credential.access))).toEqual(
        new Set(["access-2"]),
      )
      expect(ConsoleCredentials.stored(target)?.refresh).toBe("refresh-2")
    }),
  )

  it.live("finishes a refresh the caller stopped waiting for, so its single-use token is never sent twice", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      save(target, signIn(console.state, Date.now() + 30_000))

      // The fake Console takes 20ms to rotate, longer than this caller waits.
      yield* ConsoleCredentials.fresh(target, console.http).pipe(Effect.timeoutOption("5 millis"))
      yield* Effect.promise(() => until(() => ConsoleCredentials.stored(target)?.refresh === "refresh-2"))

      expect(console.state.refreshes).toBe(1)
      expect((yield* ConsoleCredentials.fresh(target, console.http))?.type === "oauth").toBe(true)
      expect(console.state.refreshes).toBe(1)
    }),
  )

  it.live("doesn't bring a sign-in back when a refresh finishes after logout started", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      save(target, signIn(console.state, Date.now() + 30_000))

      const refreshing = yield* ConsoleCredentials.fresh(target, console.http).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Effect.promise(() =>
        until(() => console.state.requests.some((request) => request.url.endsWith("/auth/device/token"))),
      )
      yield* ConsoleCredentials.logout(target, console.http)
      yield* Fiber.join(refreshing)

      expect(ConsoleCredentials.stored(target)).toBeUndefined()
    }),
  )

  it.live("keeps a token that is not about to expire", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      save(target, signIn(console.state, Date.now() + 3_600_000))

      expect((yield* ConsoleCredentials.fresh(target, console.http))?.type).toBe("oauth")
      expect(console.state.requests).toEqual([])
    }),
  )

  it.live("uses OPENCODE_API_KEY over a stored sign-in without calling the Console", () =>
    withEnv({ OPENCODE_API_KEY: "oc_sk_ci" }, () =>
      Effect.gen(function* () {
        const target = yield* store
        const console = fakeConsole()
        save(target, signIn(console.state, 0))

        expect(yield* ConsoleCredentials.fresh(target, console.http)).toEqual({ type: "key", key: "oc_sk_ci" })
        expect(console.state.requests).toEqual([])
      }),
    ),
  )

  it.live("signs out locally even when the Console is unreachable", () =>
    Effect.gen(function* () {
      const target = yield* store
      const console = fakeConsole()
      save(target, signIn(console.state, Date.now() + 3_600_000))
      WorkspaceSnapshot.write(target, { owner: "acme", fetched: Date.now(), config: {} })

      expect(yield* ConsoleCredentials.logout(target, console.http)).toBe(true)
      expect(console.state.revoked).toEqual(["refresh-1"])
      expect(ConsoleCredentials.stored(target)).toBeUndefined()
      expect(WorkspaceSnapshot.read(target)).toBeUndefined()

      save(target, signIn(console.state, Date.now() + 3_600_000))
      const offline = fakeConsole({ revoke: () => new Response(null, { status: 503 }) })
      yield* ConsoleCredentials.logout(target, offline.http)
      expect(ConsoleCredentials.stored(target)).toBeUndefined()
    }),
  )
})
