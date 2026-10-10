import { describe, expect } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, Fiber } from "effect"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "../fixture/location"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"
import { toolIdentity } from "../lib/tool"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, Location.node, Database.node, Agent.node, Permission.node]), [
    Location.node.replace(tempLocationLayer),
    Image.node.replace(imagePassthrough),
  ]),
)
const sessionID = Session.ID.make("ses_codemode_web")
const invocation = { ...toolIdentity, agent: Agent.ID.make("test"), sessionID }

const setup = Effect.fnUntraced(function* (rules: Permission.Ruleset = []) {
  const database = yield* Database.Service
  const location = yield* Location.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: location.directory,
      title: "test",
      version: "test",
      agent: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const agents = yield* Agent.Service
  yield* agents.transform((editor) =>
    editor.update(invocation.agent, (agent) => {
      agent.permissions = [{ action: "*", resource: "*", effect: "allow" }, ...rules]
    }),
  )
})

const execute = Effect.fnUntraced(function* (code: string) {
  const tools = yield* Tool.Service
  const snapshot = yield* tools.snapshot()
  return yield* snapshot.execute({
    ...invocation,
    call: { type: "tool-call", id: "call-fetch", name: "execute", input: { code } },
  })
})

describe("Code Mode fetch", () => {
  it.live("uses read permissions for encoded file URLs and preserves allowed response methods", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "read", resource: "*", effect: "deny" },
        { action: "read", resource: "report # café.txt", effect: "allow" },
      ])
      const location = yield* Location.Service
      const file = path.join(location.directory, "report # café.txt")
      yield* Effect.promise(() => Bun.write(file, '{"value":"allowed"}'))
      const url = JSON.stringify(pathToFileURL(file).href)
      const result = yield* execute(`
        const response = await fetch(new URL(${url}))
        return [response.status, response.ok, await response.text(), await response.json(), (await response.bytes()).length]
      `)
      expect(result.metadata?.error).toBeUndefined()
      expect(JSON.parse(result.content[0].type === "text" ? result.content[0].text : "")).toEqual([
        200,
        true,
        '{"value":"allowed"}',
        { value: "allowed" },
        19,
      ])
    }),
  )

  for (const action of ["read", "external_directory"]) {
    it.live(`refuses ${action}-denied file reads even when the program catches the error`, () =>
      Effect.gen(function* () {
        yield* setup([{ action, resource: "*", effect: "deny" }])
        const location = yield* Location.Service
        const external = yield* tmpdirScoped()
        const file = path.join(action === "read" ? location.directory : external.path, "secret.txt")
        yield* Effect.promise(() => Bun.write(file, "must not be disclosed"))
        const result = yield* execute(`
          try { return await (await fetch(${JSON.stringify(pathToFileURL(file).href)})).text() }
          catch (error) { return error.message }
        `)
        expect(result.content).toEqual([{ type: "text", text: `Permission denied: ${action}` }])
      }),
    )
  }

  it.live("waits for file approval and attributes it to the invoking session and tool call", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const location = yield* Location.Service
      const file = path.join(location.directory, "pending.txt")
      yield* Effect.promise(() => Bun.write(file, "before approval"))
      const permissions = yield* Permission.Service
      const fiber = yield* execute(
        `return await (await fetch(${JSON.stringify(pathToFileURL(file).href)})).text()`,
      ).pipe(Effect.forkScoped)
      const request = yield* Effect.gen(function* () {
        while (true) {
          const pending = yield* permissions.forSession(sessionID)
          if (pending[0]) return pending[0]
          yield* Effect.promise(() => Bun.sleep(1))
        }
      }).pipe(Effect.timeout("5 seconds"))
      expect(request).toMatchObject({
        sessionID,
        action: "read",
        resources: ["pending.txt"],
        source: { type: "tool", messageID: invocation.messageID, id: "call-fetch" },
      })
      yield* Effect.promise(() => Bun.write(file, "after approval"))
      yield* permissions.reply({ requestID: request.id, reply: "once" })
      expect((yield* Fiber.join(fiber)).content).toEqual([{ type: "text", text: "after approval" }])
    }),
  )

  it.live("cancels pending file approval when the execution is interrupted", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const location = yield* Location.Service
      const permissions = yield* Permission.Service
      const fiber = yield* execute(
        `return await fetch(${JSON.stringify(pathToFileURL(path.join(location.directory, "pending.txt")).href)})`,
      ).pipe(Effect.forkScoped)
      yield* Effect.gen(function* () {
        while ((yield* permissions.forSession(sessionID)).length === 0) yield* Effect.promise(() => Bun.sleep(1))
      }).pipe(Effect.timeout("5 seconds"))
      yield* Fiber.interrupt(fiber)
      expect(yield* permissions.forSession(sessionID)).toEqual([])
    }),
  )

  it.live("preserves Bun's file method handling and non-file URL schemes", () =>
    Effect.gen(function* () {
      yield* setup()
      const location = yield* Location.Service
      const file = path.join(location.directory, "unchanged.txt")
      yield* Effect.promise(() => Bun.write(file, "unchanged"))
      const result = yield* execute(`
        const values = []
        for (const init of [
          {},
          { method: "HEAD" },
          { method: "POST", body: "replacement" },
          { method: "PUT", body: "replacement" },
          { method: "PATCH", body: "replacement" },
          { method: "DELETE" },
          { body: "replacement" },
        ]) {
          values.push(await (await fetch(${JSON.stringify(pathToFileURL(file).href)}, init)).text())
        }
        values.push(await (await fetch("data:text/plain,hello")).text())
        return values
      `)
      expect(result.content[0].type === "text" ? JSON.parse(result.content[0].text) : []).toEqual([
        ...Array(7).fill("unchanged"),
        "hello",
      ])
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("unchanged")
    }),
  )

  it.live("preserves HTTP redirects and rejects redirects to file URLs", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "deny" }])
      const location = yield* Location.Service
      const file = path.join(location.directory, "secret.txt")
      yield* Effect.promise(() => Bun.write(file, "must not be disclosed"))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch: (request) => {
              const url = new URL(request.url)
              if (url.pathname === "/file") return Response.redirect(pathToFileURL(file).href, 302)
              if (url.pathname === "/redirect") return Response.redirect(new URL("/target", url).href, 302)
              return Response.json({ value: "network" })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const allowed = yield* execute(
        `return await (await fetch(${JSON.stringify(new URL("/redirect", server.url).href)})).json()`,
      )
      expect(allowed.content).toEqual([{ type: "text", text: '{\n  "value": "network"\n}' }])
      const denied = yield* execute(
        `return await (await fetch(${JSON.stringify(new URL("/file", server.url).href)})).text()`,
      )
      expect(denied.metadata?.error).toBe(true)
      expect(JSON.stringify(denied.content)).not.toContain("must not be disclosed")
    }),
  )
})
