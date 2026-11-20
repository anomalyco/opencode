import { describe, expect } from "bun:test"
import { Cause, DateTime, Effect, Exit, Layer, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearch } from "@opencode/core/session/search"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { SessionSearchTools } from "@opencode/core/tool/plugin/session-search"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const callerSession = Session.ID.make("ses_caller")
const targetSession = Session.ID.make("ses_target")
const targetMessage = SessionMessage.ID.make("msg_target")
const encode = Schema.encodeSync(SessionMessage.Info)

const documents = (on?: boolean) =>
  on === undefined
    ? []
    : [new Document({ type: "document", info: new Info({ experimental: new ConfigExperimental.Info({ sqlite_fts: on }) }) })]

const it = testEffect(SessionSearch.layer.pipe(Layer.provideMerge(makePluginTestLayer())))

const paths = (registry: Tool.Interface) =>
  registry
    .snapshot()
    .pipe(
      Effect.map((snapshot) =>
        snapshot.codeModeCatalog ? codeModeListings(snapshot.codeModeCatalog).map((tool) => tool.path) : [],
      ),
    )

const runCode = (registry: Tool.Interface, code: string) =>
  executeTool(registry, {
    sessionID: callerSession,
    ...toolIdentity,
    call: { type: "tool-call", id: `call-${code.length}`, name: "execute", input: { code } },
  })

const callDirect = (registry: Tool.Interface, name: string, input: unknown) =>
  registry.snapshot([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
    Effect.flatMap((snapshot) =>
      snapshot.execute({
        sessionID: callerSession,
        ...toolIdentity,
        call: { type: "tool-call", id: `call-direct-${name}`, name, input },
      }),
    ),
  )

describe("SessionSearchTools", () => {
  it.live("registers session_search and session_read only when sqlite_fts is enabled, and reloads on config.updated", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const tools = yield* Tool.Service
      yield* config.setEntries(documents(false))
      yield* SessionSearchTools.Plugin.effect(yield* PluginHost.make(plugins, "test")).pipe(
        Effect.provide(permissionLayer({ assert: () => Effect.void })),
      )

      expect(yield* paths(tools)).not.toContain("opencode.session.search")
      expect(yield* paths(tools)).not.toContain("opencode.session.read")

      yield* config.setEntries(documents(true))
      yield* bus.publish(Event.Updated, {})
      const deadline = Date.now() + 5_000
      while (!(yield* paths(tools)).includes("opencode.session.search") && Date.now() < deadline) {
        yield* Effect.sleep("5 millis")
      }

      expect(yield* paths(tools)).toContain("opencode.session.search")
      expect(yield* paths(tools)).toContain("opencode.session.read")

      const listed = yield* tools.list()
      const searchTool = listed.find((def) => def.name === "search")
      const readTool = listed.find((def) => def.name === "read")
      expect(searchTool?.options?.namespace).toBe("opencode.session")
      expect(searchTool?.options?.codemode).toBe(true)
      expect(readTool?.options?.namespace).toBe("opencode.session")
      expect(readTool?.options?.codemode).toBe(true)
    }),
  )

  it.effect("executes session_search and session_read through Code Mode and enforces flag + permissions", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const tools = yield* Tool.Service
      const location = yield* Location.Service
      const asserted: string[] = []

      const elsewhere = Project.ID.make("prj_elsewhere")
      yield* db
        .insert(ProjectTable)
        .values([
          { id: location.project.id, worktree: AbsolutePath.make(location.directory), sandboxes: [] },
          { id: elsewhere, worktree: AbsolutePath.make("/elsewhere"), sandboxes: [] },
        ])
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: Session.ID.make("ses_elsewhere"),
          project_id: elsewhere,
          slug: "elsewhere",
          directory: "/elsewhere",
          title: "Walrus elsewhere",
          version: "test",
          time_created: 1_700_000_000_000,
          time_updated: 1_700_000_000_000,
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: targetSession,
          project_id: location.project.id,
          slug: "target",
          directory: "/project",
          title: "Walrus notes",
          version: "test",
          time_created: 1_700_000_000_000,
          time_updated: 1_700_000_000_000,
        })
        .run()
        .pipe(Effect.orDie)
      const message = SessionMessage.User.make({
        id: targetMessage,
        type: "user",
        text: "We decided on compact walrus layout",
        time: { created: DateTime.makeUnsafe(1_700_000_000_000) },
      })
      const { id: _, type, ...data } = encode(message)
      yield* db
        .insert(SessionMessageTable)
        .values({
          id: targetMessage,
          session_id: targetSession,
          type,
          seq: 1,
          time_created: 1_700_000_000_000,
          time_updated: 1_700_000_000_000,
          data,
        })
        .run()
        .pipe(Effect.orDie)
      yield* SessionSearchIndex.ensure(db)
      while (!(yield* SessionSearchIndex.buildChunk(db)).done) {}

      yield* config.setEntries(documents(true))
      yield* SessionSearchTools.Plugin.effect(yield* PluginHost.make(plugins, "test")).pipe(
        Effect.provide(
          permissionLayer({
            assert: (input) =>
              Effect.sync(() => {
                asserted.push(input.action)
              }),
          }),
        ),
      )

      // Defaults to the caller's project; scope: "all" widens it.
      const searched = yield* runCode(tools, `return await tools.opencode.session.search({ query: "walrus" })`)
      expect(searched.status).toBe("completed")
      const scoped = JSON.parse(searched.content?.[0]?.type === "text" ? searched.content[0].text : "")
      expect(scoped.results.map((r: { sessionID: string }) => r.sessionID)).toEqual([targetSession])
      const everywhere = yield* runCode(tools, `return await tools.opencode.session.search({ query: "walrus", scope: "all" })`)
      const all = JSON.parse(everywhere.content?.[0]?.type === "text" ? everywhere.content[0].text : "")
      expect(all.results.map((r: { sessionID: string }) => r.sessionID).toSorted()).toEqual(["ses_elsewhere", targetSession].toSorted())

      const read = yield* runCode(
        tools,
        `return await tools.opencode.session.read({ sessionID: ${JSON.stringify(targetSession)}, messageID: ${JSON.stringify(targetMessage)} })`,
      )
      expect(read.status).toBe("completed")
      expect(JSON.parse(read.content?.[0]?.type === "text" ? read.content[0].text : "")).toMatchObject({
        session: { sessionID: targetSession },
        messages: [{ messageID: targetMessage, text: "We decided on compact walrus layout" }],
      })
      expect(asserted).toEqual(["opencode_session_search", "opencode_session_search", "opencode_session_read"])

      // Turning the flag off after registration stops execution cleanly.
      yield* config.setEntries(documents(false))
      const disabled = yield* callDirect(tools, "opencode_session_search", { query: "walrus" }).pipe(Effect.flip)
      expect(disabled.message).toContain("sqlite_fts")
    }),
  )

  it.effect("maps Permission.CorrectedError to ToolFailure and lets Permission.DeclinedError propagate as a defect", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      const tools = yield* Tool.Service
      let mode: "correct" | "decline" = "correct"

      yield* config.setEntries(documents(true))
      yield* SessionSearchTools.Plugin.effect(yield* PluginHost.make(plugins, "test")).pipe(
        Effect.provide(
          permissionLayer({
            assert: () =>
              mode === "correct"
                ? Effect.fail(new Permission.CorrectedError({ feedback: "Stay in this project" }))
                : Effect.die(new Permission.DeclinedError()),
          }),
        ),
      )

      const corrected = yield* callDirect(tools, "opencode_session_search", {}).pipe(Effect.flip)
      expect(corrected.message).toContain("Stay in this project")

      mode = "decline"
      const declined = yield* Effect.exit(callDirect(tools, "opencode_session_search", {}))
      expect(Exit.isFailure(declined)).toBe(true)
      if (Exit.isFailure(declined)) expect(Cause.squash(declined.cause)).toBeInstanceOf(Permission.DeclinedError)
    }),
  )
})
