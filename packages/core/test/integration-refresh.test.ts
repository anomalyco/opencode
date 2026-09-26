import { describe, expect, test } from "bun:test"
import path from "path"
import { Clock, Deferred, Duration, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { runLockWorker, waitForFile } from "./fixture/lock-worker"
import { offlineModels } from "./fixture/models"
import { refreshOAuth } from "./fixture/oauth-refresh"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node, Bus.node]), [
    Global.node.replace(tempGlobalLayer),
  ]),
)
const locationIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Credential.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

function oauthValue(methodID: Integration.MethodID, token: string, expires = 0) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: `access-${token}`,
    refresh: `refresh-${token}`,
    expires,
  })
}

function setupRefresh(input: {
  integrationID: Integration.ID
  methodID: Integration.MethodID
  value: Credential.OAuth
  label?: string
  refresh: (
    current: Credential.OAuth,
    credential: Credential.Info,
    credentials: Credential.Interface,
  ) => Effect.Effect<Credential.OAuth, unknown>
}) {
  return Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    const credential = yield* credentials.create({
      integrationID: input.integrationID,
      label: input.label,
      value: input.value,
    })
    yield* integrations.transform((editor) =>
      editor.method.update({
        integrationID: input.integrationID,
        method: { id: input.methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unexpected authorization"),
        refresh: (current) => input.refresh(current, credential, credentials),
      }),
    )
    return {
      integrations,
      credentials,
      credential,
      resolve: integrations.connection.resolve({
        type: "credential",
        id: credential.id,
        label: credential.label,
        method: "oauth",
      }),
    }
  })
}

function rotatingOAuth(methodID: Integration.MethodID) {
  let refresh = "refresh-0"
  let exchanges = 0
  let revoked = false
  let failNext = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const input = await request.json()
      const token = typeof input === "object" && input !== null && "refresh" in input ? input.refresh : undefined
      if (revoked || token !== refresh) {
        revoked = true
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      }
      exchanges++
      refresh = `refresh-${exchanges}`
      if (failNext) {
        failNext = false
        return Response.json({ error: "response_lost" }, { status: 500 })
      }
      return Response.json({ access: `access-${exchanges}`, refresh, expires: Date.now() + 300_000 })
    },
  })
  return {
    initial: oauthValue(methodID, "0"),
    refresh: (credential: Credential.OAuth) => refreshOAuth(server.url.href, methodID, credential),
    url: server.url.href,
    state: () => ({ exchanges, refresh, revoked }),
    failNext: () => (failNext = true),
    [Symbol.dispose]() {
      server.stop(true)
    },
  }
}

function sharedStoreLayer(root: string, database: string) {
  const data = path.join(root, "data")
  const cache = path.join(root, "cache")
  return AppNodeBuilder.build(LayerNode.group([Credential.node, Bus.node]), [
    Database.node.replace(Database.configured({ path: database })),
    Global.node.replace(
      Global.layerWith({
        data,
        cache,
        config: path.join(root, "config"),
        state: path.join(root, "state"),
        tmp: path.join(root, "tmp"),
        bin: path.join(cache, "bin"),
        log: path.join(data, "log"),
        repos: path.join(data, "repos"),
      }),
    ),
  ])
}

describe("Integration refresh", () => {
  it.effect("uses a newly issued five-minute OAuth token without refreshing it", () =>
    Effect.gen(function* () {
      const integrationID = Integration.ID.make("short-lived")
      const methodID = Integration.MethodID.make("oauth")
      const now = 1_000_000
      const value = oauthValue(methodID, "fresh", now + 300_000)
      let refreshes = 0
      yield* TestClock.setTime(now)
      const fixture = yield* setupRefresh({
        integrationID,
        methodID,
        value,
        refresh: () =>
          Effect.sync(() => {
            refreshes++
            return oauthValue(methodID, "refreshed", now + 600_000)
          }),
      })

      expect(yield* fixture.resolve).toEqual(value)
      expect(refreshes).toBe(0)
    }),
  )

  it.effect("does not overwrite a credential replaced while its refresh is in flight", () =>
    Effect.gen(function* () {
      const integrationID = Integration.ID.make("replacement")
      const methodID = Integration.MethodID.make("oauth")
      const winner = oauthValue(methodID, "winner", 600_000)
      const stale = oauthValue(methodID, "stale", 600_000)
      const fixture = yield* setupRefresh({
        integrationID,
        methodID,
        value: oauthValue(methodID, "old"),
        refresh: (_current, credential, credentials) =>
          credentials.update(credential.id, { value: winner }).pipe(Effect.as(stale)),
      })

      expect(yield* fixture.resolve).toEqual(winner)
      expect((yield* fixture.credentials.get(fixture.credential.id))?.value).toEqual(winner)
    }),
  )

  it.effect("preserves a credential selected by a concurrent login", () =>
    Effect.gen(function* () {
      const integrationID = Integration.ID.make("login")
      const methodID = Integration.MethodID.make("oauth")
      const login = oauthValue(methodID, "login", 600_000)
      const refreshed = oauthValue(methodID, "refreshed", 600_000)
      let selected: Credential.Info | undefined
      const fixture = yield* setupRefresh({
        integrationID,
        methodID,
        label: "Old",
        value: oauthValue(methodID, "old"),
        refresh: (_current, _credential, credentials) =>
          credentials.create({ integrationID, label: "Login", value: login }).pipe(
            Effect.tap((credential) => Effect.sync(() => (selected = credential))),
            Effect.as(refreshed),
          ),
      })

      expect(yield* fixture.resolve).toEqual(refreshed)
      if (!selected) return yield* Effect.die("Concurrent login credential missing")
      expect(yield* fixture.integrations.connection.active(integrationID)).toEqual({
        type: "credential",
        id: selected.id,
        label: "Login",
        method: "oauth",
      })
      expect((yield* fixture.credentials.get(selected.id))?.value).toEqual(login)
    }),
  )

  it.live("shares a failed exchange without replaying an uncertain refresh token", () =>
    Effect.gen(function* () {
      const integrationID = Integration.ID.make("failure")
      const methodID = Integration.MethodID.make("oauth")
      const refreshed = oauthValue(methodID, "new", 600_000)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let attempts = 0
      let fail = true
      const fixture = yield* setupRefresh({
        integrationID,
        methodID,
        value: oauthValue(methodID, "old"),
        refresh: () =>
          Effect.gen(function* () {
            attempts++
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            if (fail) return yield* Effect.fail(new Error("fixture refresh failed"))
            return refreshed
          }),
      })

      const owner = yield* fixture.resolve.pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      const waiter = yield* fixture.resolve.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      const exits = yield* Effect.all([Fiber.await(owner), Fiber.await(waiter)], { concurrency: "unbounded" })
      expect(exits.every(Exit.isFailure)).toBe(true)
      expect(attempts).toBe(1)
      expect((yield* fixture.resolve.pipe(Effect.flip)).message).toBe(
        "OAuth refresh previously failed; reconnect the credential",
      )
      expect(attempts).toBe(1)

      yield* fixture.credentials.update(fixture.credential.id, {
        value: Credential.OAuth.make({ ...oauthValue(methodID, "updated", 1), refresh: "refresh-old" }),
      })
      expect((yield* fixture.resolve.pipe(Effect.flip)).message).toBe(
        "OAuth refresh previously failed; reconnect the credential",
      )
      expect(attempts).toBe(1)

      fail = false
      yield* fixture.credentials.update(fixture.credential.id, { value: oauthValue(methodID, "reconnected") })
      expect(yield* fixture.resolve).toEqual(refreshed)
      expect(attempts).toBe(2)
    }),
  )

  it.effect("releases coordination after cancellation and timeout without replaying uncertain tokens", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["cancellation", "timeout"] as const, (mode) =>
        Effect.gen(function* () {
          const integrationID = Integration.ID.make(mode)
          const methodID = Integration.MethodID.make("oauth")
          const refreshed = oauthValue(methodID, "new", 600_000)
          const entered = yield* Deferred.make<void>()
          let attempts = 0
          const fixture = yield* setupRefresh({
            integrationID,
            methodID,
            value: oauthValue(methodID, "old"),
            refresh: () =>
              Effect.gen(function* () {
                attempts++
                if (attempts > 1) return refreshed
                yield* Deferred.succeed(entered, undefined)
                return yield* Effect.never
              }),
          })
          const owner = yield* fixture.resolve.pipe(Effect.forkScoped)
          yield* Deferred.await(entered)
          if (mode === "cancellation") yield* Fiber.interrupt(owner)
          if (mode === "timeout") {
            yield* TestClock.adjust(Duration.minutes(1))
            expect(Exit.isFailure(yield* Fiber.await(owner))).toBe(true)
          }
          expect((yield* fixture.resolve.pipe(Effect.flip)).message).toBe(
            "OAuth refresh previously failed; reconnect the credential",
          )
          expect(attempts).toBe(1)

          yield* fixture.credentials.update(fixture.credential.id, {
            value: oauthValue(methodID, "reconnected"),
          })
          expect(yield* fixture.resolve).toEqual(refreshed)
          expect(attempts).toBe(2)
          expect((yield* fixture.credentials.get(fixture.credential.id))?.value).toEqual(refreshed)
        }).pipe(Effect.scoped),
      )
    }),
  )

  it.effect("refreshes different credentials independently", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("independent")
      const methodID = Integration.MethodID.make("oauth")
      const bothEntered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let active = 0
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () => Effect.die("unexpected authorization"),
          refresh: (current) =>
            Effect.gen(function* () {
              active++
              if (active === 2) yield* Deferred.succeed(bothEntered, undefined)
              yield* Deferred.await(release)
              return Credential.OAuth.make({
                ...current,
                access: `next-${current.access}`,
                refresh: `next-${current.refresh}`,
                expires: 600_000,
              })
            }),
        }),
      )
      const saved = yield* Effect.forEach(["first", "second"], (name) =>
        credentials.create({ integrationID, label: name, value: oauthValue(methodID, name) }),
      )
      const resolutions = yield* Effect.forEach(
        saved,
        (credential) =>
          integrations.connection
            .resolve({ type: "credential", id: credential.id, label: credential.label, method: "oauth" })
            .pipe(Effect.forkScoped),
        { concurrency: "unbounded" },
      )

      yield* Deferred.await(bothEntered)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Effect.forEach(resolutions, Fiber.join, { concurrency: "unbounded" })).toEqual([
        expect.objectContaining({ access: "next-access-first", refresh: "next-refresh-first" }),
        expect.objectContaining({ access: "next-access-second", refresh: "next-refresh-second" }),
      ])
    }),
  )

  locationIt.live("coordinates a rotating refresh across two locations", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const locations = yield* LocationServiceMap.Service
      const first = yield* tmpdirScoped("opencode-refresh-first-")
      const second = yield* tmpdirScoped("opencode-refresh-second-")
      const integrationID = Integration.ID.make("rotating")
      const methodID = Integration.MethodID.make("oauth")
      using oauth = rotatingOAuth(methodID)
      const credential = yield* credentials.create({ integrationID, value: oauth.initial })
      const refs = [first, second].map((dir) => Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))
      const register = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: "OAuth" },
              authorize: () => Effect.die("unexpected authorization"),
              refresh: oauth.refresh,
            }),
          )
        }).pipe(Effect.provide(locations.get(ref)))
      yield* Effect.forEach(refs, register)
      const resolve = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          return yield* integrations.connection.resolve({
            type: "credential",
            id: credential.id,
            label: credential.label,
            method: "oauth",
          })
        }).pipe(Effect.provide(locations.get(ref)))

      const results = yield* Effect.all(refs.map(resolve), { concurrency: "unbounded" })
      expect(results).toEqual([
        expect.objectContaining({ access: "access-1", refresh: "refresh-1" }),
        expect.objectContaining({ access: "access-1", refresh: "refresh-1" }),
      ])
      expect(oauth.state()).toEqual({ exchanges: 1, refresh: "refresh-1", revoked: false })

      const persisted = yield* credentials.get(credential.id)
      if (!persisted || persisted.value.type !== "oauth") return yield* Effect.die("OAuth credential missing")
      yield* credentials.update(credential.id, { value: { ...persisted.value, expires: 0 } })
      expect(yield* resolve(refs[1]!)).toEqual(expect.objectContaining({ access: "access-2", refresh: "refresh-2" }))
      expect(oauth.state()).toEqual({ exchanges: 2, refresh: "refresh-2", revoked: false })
    }),
  )

  test("coordinates rotating refreshes across processes sharing credential storage", async () => {
    await using temp = await tmpdir("opencode-refresh-process-")
    const root = temp.path
    const database = path.join(root, "opencode.db")
    const integrationID = Integration.ID.make("rotating-process")
    const methodID = Integration.MethodID.make("oauth")
    using oauth = rotatingOAuth(methodID)
    const credential = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          return yield* credentials.create({ integrationID, value: oauth.initial })
        }).pipe(Effect.provide(sharedStoreLayer(root, database))),
      ),
    )
    const worker = path.join(import.meta.dir, "fixture/integration-refresh-worker.ts")
    const go = path.join(root, "go")
    const inputs = ["first", "second"].map((name) => ({
      root,
      database,
      state: path.join(root, `${name}.state`),
      endpoint: oauth.url,
      integrationID,
      methodID,
      credentialID: credential.id,
      label: credential.label,
      ready: path.join(root, `${name}.ready`),
      go,
      result: path.join(root, `${name}.json`),
    }))
    const workers = inputs.map((input) => runLockWorker(worker, input))
    // Full-suite process contention can delay booting two complete service graphs.
    await Promise.all(inputs.map((input) => waitForFile(input.ready, 60_000)))
    await Bun.write(go, "go")
    const exits = await Promise.all(workers)
    expect(exits.map((result) => result.code)).toEqual([0, 0])
    expect(exits.map((result) => result.stderr.toString()).filter(Boolean)).toEqual([])
    expect(await Promise.all(inputs.map((input) => Bun.file(input.result).json()))).toEqual([
      expect.objectContaining({ access: "access-1", refresh: "refresh-1" }),
      expect.objectContaining({ access: "access-1", refresh: "refresh-1" }),
    ])
    expect(oauth.state()).toEqual({ exchanges: 1, refresh: "refresh-1", revoked: false })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const persisted = yield* credentials.get(credential.id)
          if (!persisted || persisted.value.type !== "oauth") return yield* Effect.die("OAuth credential missing")
          yield* credentials.update(credential.id, { value: { ...persisted.value, expires: 0 } })
        }).pipe(Effect.provide(sharedStoreLayer(root, database))),
      ),
    )
    const next = { ...inputs[0]!, ready: path.join(root, "next.ready"), result: path.join(root, "next.json") }
    const nextExit = await runLockWorker(worker, next)
    expect(nextExit.code).toBe(0)
    expect(nextExit.stderr.toString()).toBe("")
    expect(await Bun.file(next.result).json()).toEqual(
      expect.objectContaining({ access: "access-2", refresh: "refresh-2" }),
    )
    expect(oauth.state()).toEqual({ exchanges: 2, refresh: "refresh-2", revoked: false })

    const persisted = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          return yield* credentials.get(credential.id)
        }).pipe(Effect.provide(sharedStoreLayer(root, database))),
      ),
    )
    expect(persisted?.value).toEqual(expect.objectContaining({ access: "access-2", refresh: "refresh-2" }))

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const current = yield* credentials.get(credential.id)
          if (!current || current.value.type !== "oauth") return yield* Effect.die("OAuth credential missing")
          yield* credentials.update(credential.id, { value: { ...current.value, expires: 0 } })
        }).pipe(Effect.provide(sharedStoreLayer(root, database))),
      ),
    )
    oauth.failNext()
    const failureGo = path.join(root, "failure.go")
    const failures = ["failure-first", "failure-second"].map((name, index) => ({
      ...inputs[index]!,
      state: path.join(root, `${name}.state`),
      ready: path.join(root, `${name}.ready`),
      go: failureGo,
      result: path.join(root, `${name}.json`),
    }))
    const failedWorkers = failures.map((input) => runLockWorker(worker, input))
    await Promise.all(failures.map((input) => waitForFile(input.ready, 30_000)))
    await Bun.write(failureGo, "go")
    expect((await Promise.all(failedWorkers)).map((result) => result.code)).toEqual([1, 1])
    expect(oauth.state()).toEqual({ exchanges: 3, refresh: "refresh-3", revoked: false })

    const blocked = await runLockWorker(worker, {
      ...failures[0]!,
      state: path.join(root, "blocked.state"),
      ready: path.join(root, "blocked.ready"),
      result: path.join(root, "blocked.json"),
    })
    expect(blocked.code).toBe(1)
    expect(oauth.state()).toEqual({ exchanges: 3, refresh: "refresh-3", revoked: false })
  }, 120_000)
})
