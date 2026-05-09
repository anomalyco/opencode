import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app(experimental: boolean) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}
type TestApp = ReturnType<typeof app>

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

const seedSessions = Effect.gen(function* () {
  const svc = yield* Session.Service
  const parent = yield* svc.create({ title: "parent" })
  yield* svc.create({ title: "child", parentID: parent.id })
  const message = yield* svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: parent.id,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  yield* svc.updatePart({
    id: PartID.ascending(),
    sessionID: parent.id,
    messageID: message.id,
    type: "text",
    text: "hello",
  })
  return { parent, message }
})

function withTmp<A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => fn(tmp).pipe(provideInstance(tmp.path))))
}

function readJson(label: string, serverApp: TestApp, path: string, headers: HeadersInit) {
  return Effect.promise(async () => {
    const response = await serverApp.request(path, { headers })
    if (response.status !== 200) throw new Error(`${label} returned ${response.status}: ${await response.text()}`)
    return await response.json()
  })
}

function expectJsonParity(input: {
  label: string
  legacy: TestApp
  httpapi: TestApp
  path: string
  headers: HeadersInit
}) {
  return Effect.gen(function* () {
    const legacy = yield* readJson(input.label, input.legacy, input.path, input.headers)
    const httpapi = yield* readJson(input.label, input.httpapi, input.path, input.headers)
    expect({ label: input.label, body: httpapi }).toEqual({ label: input.label, body: legacy })
    return httpapi
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi JSON parity", () => {
  it.live(
    "matches legacy JSON shape for safe GET endpoints",
    withTmp(
      {
        git: true,
        config: {
          formatter: false,
          lsp: false,
          mcp: {
            demo: {
              type: "local",
              command: ["echo", "demo"],
              enabled: false,
            },
          },
        },
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.write(`${tmp.path}/hello.txt`, "hello\n"))

          const headers = { "x-opencode-directory": tmp.path }
          const legacy = app(false)
          const httpapi = app(true)

          yield* Effect.forEach(
            [
              { label: "global.health", path: GlobalPaths.health, headers: {} },
              { label: "global.config", path: GlobalPaths.config, headers: {} },
              { label: "instance.path", path: InstancePaths.path, headers },
              { label: "instance.vcs", path: InstancePaths.vcs, headers },
              { label: "instance.vcsDiff", path: `${InstancePaths.vcsDiff}?mode=git`, headers },
              { label: "instance.command", path: InstancePaths.command, headers },
              { label: "instance.agent", path: InstancePaths.agent, headers },
              { label: "instance.skill", path: InstancePaths.skill, headers },
              { label: "instance.lsp", path: InstancePaths.lsp, headers },
              { label: "instance.formatter", path: InstancePaths.formatter, headers },
              { label: "config.get", path: "/config", headers },
              { label: "config.providers", path: "/config/providers", headers },
              { label: "project.list", path: "/project", headers },
              { label: "project.current", path: "/project/current", headers },
              { label: "provider.list", path: "/provider", headers },
              { label: "provider.auth", path: "/provider/auth", headers },
              { label: "permission.list", path: "/permission", headers },
              { label: "question.list", path: "/question", headers },
              { label: "mcp.status", path: McpPaths.status, headers },
              { label: "pty.shells", path: PtyPaths.shells, headers },
              { label: "pty.list", path: PtyPaths.list, headers },
              { label: "file.list", path: `${FilePaths.list}?${new URLSearchParams({ path: "." })}`, headers },
              {
                label: "file.content",
                path: `${FilePaths.content}?${new URLSearchParams({ path: "hello.txt" })}`,
                headers,
              },
              { label: "file.status", path: FilePaths.status, headers },
              {
                label: "find.file",
                path: `${FilePaths.findFile}?${new URLSearchParams({ query: "hello", dirs: "false" })}`,
                headers,
              },
              {
                label: "find.text",
                path: `${FilePaths.findText}?${new URLSearchParams({ pattern: "hello" })}`,
                headers,
              },
              {
                label: "find.symbol",
                path: `${FilePaths.findSymbol}?${new URLSearchParams({ query: "hello" })}`,
                headers,
              },
              { label: "experimental.console", path: ExperimentalPaths.console, headers },
              { label: "experimental.consoleOrgs", path: ExperimentalPaths.consoleOrgs, headers },
              { label: "experimental.toolIDs", path: ExperimentalPaths.toolIDs, headers },
              { label: "experimental.worktree", path: ExperimentalPaths.worktree, headers },
              { label: "experimental.resource", path: ExperimentalPaths.resource, headers },
            ],
            (input) => expectJsonParity({ ...input, legacy, httpapi }),
            { concurrency: 1 },
          )
        }),
    ),
  )

  it.live(
    "matches legacy JSON shape for session read endpoints",
    withTmp({ git: true, config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": tmp.path }
        const seeded = yield* seedSessions.pipe(Effect.provide(Session.defaultLayer))
        const legacy = app(false)
        const httpapi = app(true)

        const rootsFalse = yield* expectJsonParity({
          label: "session.list roots false",
          legacy,
          httpapi,
          path: `${SessionPaths.list}?roots=false`,
          headers,
        })
        expect((rootsFalse as Session.Info[]).map((session) => session.id)).toContain(seeded.parent.id)
        expect((rootsFalse as Session.Info[]).length).toBe(2)

        const experimentalRootsFalse = yield* expectJsonParity({
          label: "experimental.session roots false",
          legacy,
          httpapi,
          path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10", roots: "false" })}`,
          headers,
        })
        expect((experimentalRootsFalse as Session.GlobalInfo[]).length).toBe(2)

        const experimentalArchivedFalse = yield* expectJsonParity({
          label: "experimental.session archived false",
          legacy,
          httpapi,
          path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10", archived: "false" })}`,
          headers,
        })
        expect((experimentalArchivedFalse as Session.GlobalInfo[]).length).toBe(2)

        yield* Effect.forEach(
          [
            { label: "session.list roots", path: `${SessionPaths.list}?roots=true`, headers },
            { label: "session.list all", path: SessionPaths.list, headers },
            { label: "session.get", path: pathFor(SessionPaths.get, { sessionID: seeded.parent.id }), headers },
            {
              label: "session.children",
              path: pathFor(SessionPaths.children, { sessionID: seeded.parent.id }),
              headers,
            },
            {
              label: "session.messages",
              path: pathFor(SessionPaths.messages, { sessionID: seeded.parent.id }),
              headers,
            },
            {
              label: "session.messages empty before",
              path: `${pathFor(SessionPaths.messages, { sessionID: seeded.parent.id })}?before=`,
              headers,
            },
            {
              label: "session.message",
              path: pathFor(SessionPaths.message, { sessionID: seeded.parent.id, messageID: seeded.message.id }),
              headers,
            },
            {
              label: "experimental.session",
              path: `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "10" })}`,
              headers,
            },
          ],
          (input) => expectJsonParity({ ...input, legacy, httpapi }),
          { concurrency: 1 },
        )
      }),
    ),
  )
})
