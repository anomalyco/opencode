import { describe, expect } from "bun:test"
import type { ConfigPolicy } from "@opencode/schema/config/policy"
import { ConnectStore } from "@opencode/client-core/store"
import { WorkspaceSnapshot } from "@opencode/client-core/snapshot"
import { WorkspaceSync } from "@opencode/client-core/workspace-sync"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../../core/test/lib/effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { fakeConsole, signIn } from "./fixture/console"

const policies: ConfigPolicy.Info[] = [{ action: "tool.use", resource: "shell:rm *", effect: "deny" }]
// Every test signs in with a token that outlives the test clock, so syncs never refresh.
const signedIn = (console: ReturnType<typeof fakeConsole>) =>
  tmpdirScoped("opencode-connect-test-").pipe(
    Effect.map((dir) => {
      const store = ConnectStore.make(dir.path)
      ConnectStore.write(
        ConnectStore.credentialFile(store),
        JSON.stringify(signIn(console.state, Number.MAX_SAFE_INTEGER)),
      )
      return store
    }),
  )

describe("WorkspaceSync.sync", () => {
  it.effect("fetches the workspace config and reuses it for a minute", () =>
    Effect.gen(function* () {
      const console = fakeConsole({ config: () => Response.json({ policies, websearch: { provider: "opencode" } }) })
      const store = yield* signedIn(console)

      const first = yield* WorkspaceSync.sync(store, console.http)
      expect(first.snapshot?.organization).toBe("Acme")
      expect(WorkspaceSnapshot.policies(first.snapshot)).toEqual(policies)
      expect(WorkspaceSnapshot.read(store)).toEqual(first.snapshot)

      yield* TestClock.adjust("59 seconds")
      yield* WorkspaceSync.sync(store, console.http)
      expect(console.state.configs).toBe(1)

      yield* TestClock.adjust("1 second")
      yield* WorkspaceSync.sync(store, console.http)
      expect(console.state.configs).toBe(2)

      yield* WorkspaceSync.sync(store, console.http, { force: true })
      expect(console.state.configs).toBe(3)
    }),
  )

  it.effect("names the connector and harness to the Console", () =>
    Effect.gen(function* () {
      const console = fakeConsole()
      const store = yield* signedIn(console)

      yield* WorkspaceSync.sync(
        store,
        WorkspaceSync.identify(console.http, { version: "2.2.5", harness: "claude-cli/2.1.304" }),
      )

      const request = console.state.requests.find((item) => item.url.endsWith("/api/v2/config"))
      expect(request?.headers.get("user-agent")).toBe("claude-cli/2.1.304 opencode-connect/2.2.5")
      expect(request?.headers.get("x-opencode-plugin")).toBe("connect/2.2.5")
      expect(request?.headers.get("authorization")).toBe("Bearer access-1")
      expect(request?.headers.get("x-org-id")).toBe("org_acme")
    }),
  )

  it.effect("keeps the last config when the Console is unreachable, so policies never lapse", () =>
    Effect.gen(function* () {
      const answer = { current: () => Response.json({ policies }) }
      const console = fakeConsole({ config: () => answer.current() })
      const store = yield* signedIn(console)
      yield* WorkspaceSync.sync(store, console.http)

      answer.current = () => new Response("unavailable", { status: 503 })
      yield* TestClock.adjust("2 minutes")
      const result = yield* WorkspaceSync.sync(store, console.http)

      expect(result.error).toBeDefined()
      expect(WorkspaceSnapshot.policies(result.snapshot)).toEqual(policies)
      expect(WorkspaceSnapshot.policies(WorkspaceSnapshot.read(store))).toEqual(policies)
    }),
  )

  it.effect("keeps the last config and reports why when the workspace needs SSO again", () =>
    Effect.gen(function* () {
      const answer = { current: () => Response.json({ policies }) }
      const console = fakeConsole({ config: () => answer.current() })
      const store = yield* signedIn(console)
      yield* WorkspaceSync.sync(store, console.http)

      answer.current = () =>
        Response.json({ _tag: "SsoRequired", orgId: "org_acme", connectionId: "conn_okta" }, { status: 403 })
      yield* TestClock.adjust("2 minutes")
      const result = yield* WorkspaceSync.sync(store, console.http)

      expect(WorkspaceSnapshot.policies(result.snapshot)).toEqual(policies)
      expect(result.snapshot?.status).toEqual({
        message: "Sign in with SSO again to use Acme",
        url: "https://console.test/console/auth/sso/conn_okta/start?redirectTo=%2Fconsole%2F",
      })
    }),
  )

  it.effect("drops the config when the Console serves none for the sign-in", () =>
    Effect.gen(function* () {
      const answer = { current: () => Response.json({ policies }) }
      const console = fakeConsole({ config: () => answer.current() })
      const store = yield* signedIn(console)
      yield* WorkspaceSync.sync(store, console.http)

      answer.current = () => new Response(null, { status: 404 })
      const result = yield* WorkspaceSync.sync(store, console.http, { force: true })

      expect(result.snapshot?.config).toBeUndefined()
      expect(WorkspaceSnapshot.policies(result.snapshot)).toEqual([])
    }),
  )

  it.effect("never reuses another sign-in's config", () =>
    Effect.gen(function* () {
      const console = fakeConsole({ config: () => new Response("unavailable", { status: 503 }) })
      const store = yield* signedIn(console)
      WorkspaceSnapshot.write(store, {
        owner: JSON.stringify(["https://console.test/console", "usr_ada", "org_other"]),
        organization: "Other",
        fetched: 0,
        config: { policies },
      })

      const result = yield* WorkspaceSync.sync(store, console.http)

      expect(result.error).toBeDefined()
      expect(result.snapshot).toBeUndefined()
    }),
  )

  it.effect("clears the config once signed out", () =>
    Effect.gen(function* () {
      const console = fakeConsole({ config: () => Response.json({ policies }) })
      const store = yield* signedIn(console)
      yield* WorkspaceSync.sync(store, console.http)

      ConnectStore.remove(ConnectStore.credentialFile(store))
      expect((yield* WorkspaceSync.sync(store, console.http)).snapshot).toBeUndefined()
      expect(WorkspaceSnapshot.read(store)).toBeUndefined()
    }),
  )
})

describe("WorkspaceSnapshot", () => {
  it.effect("reads Library, telemetry and model counts the Console sends", () =>
    Effect.gen(function* () {
      const console = fakeConsole({
        config: () =>
          Response.json({
            providers: {
              opencode: { package: "@opencode/ai/providers/openai-compatible", models: { a: {}, b: {} } },
              "opencode-go": { package: "@opencode/ai/providers/openai-compatible", models: { c: {} } },
            },
            library: {
              instructions: [{ id: "ins_1", content: "Use pnpm." }],
              skills: [{ slug: "deploy", version: "3" }],
            },
            telemetry: {
              otlpLogsUrl: "https://console.test/api/otel/v1/logs",
              headers: { authorization: "Bearer octel_1" },
            },
          }),
      })
      const store = yield* signedIn(console)
      const snapshot = (yield* WorkspaceSync.sync(store, console.http)).snapshot

      expect(WorkspaceSnapshot.library(snapshot)).toEqual({
        instructions: [{ id: "ins_1", content: "Use pnpm." }],
        skills: [{ slug: "deploy", version: "3" }],
      })
      expect(WorkspaceSnapshot.telemetry(snapshot)?.otlpLogsUrl).toBe("https://console.test/api/otel/v1/logs")
      expect(WorkspaceSnapshot.models(snapshot)).toBe(3)
      expect(WorkspaceSnapshot.routing(snapshot)).toBe("gateway")
      expect(WorkspaceSnapshot.routing(snapshot, { keepProvider: true })).toBe("keep-provider")
      expect(WorkspaceSnapshot.routing(undefined)).toBe("keep-provider")
    }),
  )
})
