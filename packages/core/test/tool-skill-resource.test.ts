import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { FileAccess } from "@opencode-ai/core/file-access"
import { Permission } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionInstructions } from "@opencode-ai/core/session/instructions"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { Tool } from "@opencode-ai/core/tool"
import { ReadTool } from "@opencode-ai/core/tool/plugin/read"
import { SkillTool } from "@opencode-ai/core/tool/plugin/skill"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { Directory } from "@opencode-ai/schema/config"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { agentHost, host } from "./plugin/host"

const sessionID = Session.ID.make("ses_skill_resources")

const fixture = Effect.fn("SkillResourceTest.fixture")(function* (symlink: boolean) {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
  const project = path.join(tmp.path, "project")
  const config = path.join(tmp.path, "home", ".opencode")
  const source = path.join(config, "skill")
  const storage = symlink ? path.join(tmp.path, "dotfiles", "skills") : source
  yield* Effect.promise(() =>
    Promise.all([
      fs.mkdir(project, { recursive: true }),
      fs.mkdir(config, { recursive: true }),
      fs.mkdir(path.join(storage, "release", "references"), { recursive: true }),
    ]),
  )
  if (symlink) yield* Effect.promise(() => fs.symlink(storage, source, "dir"))
  yield* Effect.promise(() =>
    Promise.all([
      fs.writeFile(
        path.join(storage, "release", "SKILL.md"),
        "---\nname: Release\ndescription: Release guide\n---\nRead references/policy.md",
      ),
      fs.writeFile(path.join(storage, "release", "references", "policy.md"), "Release policy fixture\n"),
    ]),
  )
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Location.node,
      Global.node,
      Tool.node,
      Skill.node,
      Agent.node,
      Permission.node,
      FSUtil.node,
      FileAccess.node,
      ReadToolFileSystem.node,
      SessionInstructions.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(project) }))),
      ),
      Global.node.replace(
        Global.layerWith({
          home: path.join(tmp.path, "home"),
          config: path.join(tmp.path, "managed-config"),
          tmp: path.join(tmp.path, "managed-tmp"),
        }),
      ),
      Image.node.replace(imagePassthrough),
    ],
  )
  const context = yield* Layer.build(layer)
  yield* Effect.gen(function* () {
    const database = yield* Database.Service
    const agents = yield* Agent.Service
    const skills = yield* Skill.Service
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(project), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "skill-resources",
        directory: project,
        title: "Skill resources",
        version: "test",
        agent: "build",
      })
      .run()
      .pipe(Effect.orDie)
    yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
    yield* ConfigSkillPlugin.Plugin.effect(
      host({
        skill: {
          list: () => Effect.die("unused skill.list"),
          transform: skills.transform,
          reload: skills.reload,
        },
      }),
    ).pipe(
      Effect.provide(Config.testLayer([new Directory({ type: "directory", path: AbsolutePath.make(config) })])),
      Effect.provideService(SkillDiscovery.Service, { pull: () => Effect.succeed([]) }),
      Effect.provide(Watcher.testLayer),
    )
    yield* registerToolPlugin(SkillTool.Plugin)
    yield* registerToolPlugin(ReadTool.Plugin)
  }).pipe(Effect.provide(context))
  return { source, context }
})

describe("skill supporting files", () => {
  for (const symlink of [false, true]) {
    for (const agent of ["build", "explore"]) {
      it.live(`preserves V1 reference reads before skill invocation (${agent}, symlink=${symlink})`, () =>
        Effect.gen(function* () {
          const tmp = yield* fixture(symlink)
          yield* Effect.gen(function* () {
            const tools = yield* Tool.Service
            const bus = yield* Bus.Service
            const permission = yield* Permission.Service
            const agents = yield* Agent.Service
            expect(yield* agents.get(Agent.ID.make(agent))).toMatchObject({
              id: agent,
              mode: agent === "explore" ? "subagent" : "primary",
            })
            const requests: Permission.Request[] = []
            yield* bus.subscribe(Permission.Event.Asked).pipe(
              Stream.runForEach((event) => {
                requests.push(event.data)
                return permission.reply({ requestID: event.data.id, reply: "once" })
              }),
              Effect.forkScoped({ startImmediately: true }),
            )

            expect(
              yield* executeTool(tools, {
                sessionID,
                ...toolIdentity,
                agent: Agent.ID.make(agent),
                call: {
                  type: "tool-call",
                  id: `reference-before-invocation-${agent}`,
                  name: "read",
                  input: { path: path.join(tmp.source, "release", "references", "policy.md") },
                },
              }),
            ).toMatchObject({ status: "completed", output: { content: "Release policy fixture\n" } })
            expect(requests).toEqual([])
            yield* agents.transform((editor) =>
              editor.update(Agent.ID.make(agent), (info) => {
                info.permissions.push({ action: "external_directory", resource: "*", effect: "deny" })
              }),
            )
            expect(
              yield* executeTool(tools, {
                sessionID,
                ...toolIdentity,
                agent: Agent.ID.make(agent),
                call: {
                  type: "tool-call",
                  id: `reference-denied-${agent}`,
                  name: "read",
                  input: { path: path.join(tmp.source, "release", "references", "policy.md") },
                },
              }),
            ).toMatchObject({
              status: "error",
              error: { type: "permission.rejected", message: "Permission denied: external_directory" },
            })
            expect(requests).toEqual([])
          }).pipe(Effect.provide(tmp.context))
        }),
      )
    }

    it.live(`reads a discovered external skill reference without another prompt (symlink=${symlink})`, () =>
      Effect.gen(function* () {
        const tmp = yield* fixture(symlink)
        yield* Effect.gen(function* () {
          const agents = yield* Agent.Service
          const skills = yield* Skill.Service
          const tools = yield* Tool.Service
          const bus = yield* Bus.Service
          const permission = yield* Permission.Service
          const requests: Permission.Request[] = []
          yield* bus.subscribe(Permission.Event.Asked).pipe(
            Stream.runForEach((event) => {
              requests.push(event.data)
              // Resolve only this isolated fixture's prompts so a regression fails by
              // assertion, rather than hanging in Permission.assert.
              return permission.reply({ requestID: event.data.id, reply: "once" })
            }),
            Effect.forkScoped({ startImmediately: true }),
          )
          const read = (file: string) =>
            executeTool(tools, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call", id: "read-policy", name: "read", input: { path: file } },
            })
          const reference = path.join(tmp.source, "release", "references", "policy.md")
          const rules = (permissions: Permission.Ruleset) =>
            agents.transform((editor) =>
              editor.update(Agent.ID.make("build"), (agent) => {
                agent.permissions = [...Agent.Info.default(Agent.ID.make("build")).permissions, ...permissions]
              }),
            )

          // Documentation reads do not require invocation, even when invoking the skill is denied.
          for (const effect of ["deny", "ask", "allow"] as const) {
            yield* rules([{ action: "skill", resource: "release", effect }])
            expect(yield* read(reference)).toMatchObject({
              status: "completed",
              output: { content: "Release policy fixture\n" },
            })
            expect(requests).toEqual([])
            const invocation = yield* executeTool(tools, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call", id: `invoke-${effect}`, name: "skill", input: { id: "release" } },
            })
            expect(invocation).toMatchObject(
              effect === "deny"
                ? { status: "error", error: { type: "permission.rejected", message: "Permission denied: skill" } }
                : { status: "completed" },
            )
            expect(requests.map((request) => request.action)).toEqual(effect === "ask" ? ["skill"] : [])
            requests.length = 0
          }
          yield* rules([])
          expect(
            yield* executeTool(tools, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call", id: "load-release", name: "skill", input: { id: "release" } },
            }),
          ).toMatchObject({ status: "completed" })
          const result = yield* executeTool(tools, {
            sessionID,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "read-reference",
              name: "read",
              input: { path: path.join(tmp.source, "release", "references", "policy.md") },
            },
          })
          expect(result).toMatchObject({ status: "completed", output: { content: "Release policy fixture\n" } })
          expect(requests.map(({ action, resources }) => ({ action, resources }))).toEqual([])

          const boundary = path.join(path.dirname(reference), "*").replaceAll("\\", "/")

          // The read's allowance is not saved or reused by another external action.
          yield* permission.assert({ sessionID, action: "external_directory", resources: [boundary] })
          expect(requests.map((request) => request.action)).toEqual(["external_directory"])
          requests.length = 0

          const access = yield* FileAccess.Service
          const target = yield* access.resolve({ path: reference, kind: "file" })
          yield* access.authorizeExternal([target], {
            sessionID,
            ...toolIdentity,
            id: Tool.CallID.make("external-skill-resource"),
          })
          expect(requests.map((request) => request.action)).toEqual(["external_directory"])
          requests.length = 0

          for (const action of ["read", "external_directory"]) {
            yield* rules([{ action, resource: "*", effect: "deny" }])
            expect(yield* read(reference)).toMatchObject({
              status: "error",
              error: { type: "permission.rejected", message: `Permission denied: ${action}` },
            })
            expect(requests).toEqual([])
          }

          yield* rules([])
          const env = path.join(tmp.source, "release", "fixture.env")
          yield* Effect.promise(() => fs.writeFile(env, "fixture only\n"))
          expect(yield* read(env)).toMatchObject({ status: "completed" })
          expect(requests.map((request) => request.action)).toEqual(["read"])
          requests.length = 0

          // A common path prefix and a flat Markdown skill must not authorize siblings.
          const sibling = path.join(tmp.source, "release-notes.md")
          yield* Effect.promise(() => fs.writeFile(sibling, "Release notes\n"))
          yield* skills.transform((editor) =>
            editor.add(
              Skill.Info.make({
                id: Skill.ID.make("flat"),
                name: Skill.Name.make("Flat"),
                location: AbsolutePath.make(path.join(tmp.source, "flat.md")),
                content: "Flat skill",
              }),
            ),
          )
          expect(yield* read(sibling)).toMatchObject({ status: "completed" })
          expect(requests.map((request) => request.action)).toEqual(["external_directory"])
        }).pipe(Effect.provide(tmp.context))
      }),
    )
  }
})
