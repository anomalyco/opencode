import { describe, expect, test } from "bun:test"
import {
  Agent,
  Config,
  FileSystem,
  Form,
  Integration,
  Permission,
  Project,
  Reference,
  Session,
  Workspace,
} from "../src/index.js"
import { EventManifest } from "../src/event-manifest.js"
import { FileSystemV1 } from "../src/filesystem-v1.js"
import { IdeEvent } from "../src/ide-event.js"
import { McpEvent } from "../src/mcp-event.js"
import { Plugin } from "../src/plugin.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionTodo } from "../src/session-todo.js"
import { SessionV1 } from "../src/session-v1.js"
import { WorkspaceEvent } from "../src/workspace-event.js"

describe("public event manifest", () => {
  test("owns the complete public event surface", () => {
    expect(EventManifest.ServerDefinitions).toContain(Agent.Event.Updated)
    expect(EventManifest.ServerDefinitions.filter((definition) => definition.type === "agent.updated")).toEqual([
      Agent.Event.Updated,
    ])
    expect(EventManifest.Definitions).toContain(Agent.Event.Updated)
    expect(EventManifest.Definitions.filter((definition) => definition.type === "agent.updated")).toEqual([
      Agent.Event.Updated,
    ])
    expect(SessionV1.Event.Definitions).toEqual([
      SessionV1.Event.Created,
      SessionV1.Event.Updated,
      SessionV1.Event.Deleted,
      SessionV1.Event.MessageUpdated,
      SessionV1.Event.MessageRemoved,
      SessionV1.Event.PartUpdated,
      SessionV1.Event.PartRemoved,
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(Array.from(EventManifest.Latest.keys())).toEqual(
      EventManifest.Definitions.map((definition) => definition.type),
    )
    expect(EventManifest.Latest.get("agent.updated")).toBe(Agent.Event.Updated)
    expect(EventManifest.Latest.get("plugin.updated")).toBe(Plugin.Event.Updated)
    expect(EventManifest.Server.get("mcp.status.changed")).toBe(McpEvent.StatusChanged)
    expect(EventManifest.Server.has("mcp.tools.changed")).toBe(false)
    expect(Agent.Event.Updated.durable).toBeUndefined()
    expect(EventManifest.Durable.has("agent.updated")).toBe(false)
  })

  test("uses canonical definitions for current public events", () => {
    expect(Session.Event).toBe(SessionEvent)
    expect(Session.Event.Definitions).toBe(SessionEvent.Definitions)
    expect(Workspace.Event).toBe(WorkspaceEvent)
    expect(Workspace.Event.Definitions).toBe(WorkspaceEvent.Definitions)
    expect(EventManifest.Latest.get("session.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(SessionTodo.Event.Updated)
    expect(EventManifest.Latest.get("agent.updated")).toBe(Agent.Event.Updated)
    expect(EventManifest.Latest.get("project.updated")).toBe(Project.Event.Updated)
    expect(Agent.Event.Definitions).toEqual([Agent.Event.Updated])
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated])
    expect(Config.Event.Definitions).toEqual([Config.Event.Updated])
    expect(FileSystem.Event.Definitions).toEqual([FileSystem.Event.Changed])
    expect(FileSystemV1.Event.Definitions).toEqual([FileSystemV1.Event.Edited])
    expect(Integration.Event.Definitions).toEqual([Integration.Event.Updated, Integration.Event.ConnectionUpdated])
    expect(Permission.Event.Definitions).toEqual([Permission.Event.Asked, Permission.Event.Replied])
    expect(Form.Event.Definitions).toEqual([Form.Event.Created, Form.Event.Replied, Form.Event.Cancelled])
    expect(Reference.Event.Definitions).toEqual([Reference.Event.Updated])
    expect(Plugin.Event.Definitions).toEqual([Plugin.Event.Added, Plugin.Event.Updated])
    expect(McpEvent.Definitions).toEqual([McpEvent.ToolsChanged, McpEvent.StatusChanged])
    expect(EventManifest.Latest.has("mcp.browser.open.failed")).toBe(false)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(IdeEvent.Definitions).toEqual([IdeEvent.Installed])
    const sessionV1TailStart = EventManifest.Definitions.indexOf(SessionV1.Event.PartDelta)
    expect(EventManifest.Definitions.slice(sessionV1TailStart, sessionV1TailStart + 3)).toEqual([
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(EventManifest.Durable.get("session.step.ended.1")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Durable.has("session.step.ended.2")).toBe(false)
  })

  test("derives durable definitions from explicit definition durability", () => {
    expect(Array.from(EventManifest.Durable.keys()).toSorted()).toEqual(
      [
        "session.created.1",
        "session.updated.1",
        "session.deleted.1",
        "message.updated.1",
        "message.removed.1",
        "message.part.updated.1",
        "message.part.removed.1",
        "session.agent.selected.1",
        "session.model.selected.1",
        "session.moved.1",
        "session.renamed.1",
        "session.forked.1",
        "session.prompt.promoted.1",
        "session.prompt.admitted.1",
        "session.context.updated.1",
        "session.synthetic.1",
        "session.skill.activated.1",
        "session.shell.started.1",
        "session.shell.ended.1",
        "session.step.started.1",
        "session.step.ended.1",
        "session.step.failed.1",
        "session.text.started.1",
        "session.text.ended.1",
        "session.tool.input.started.1",
        "session.tool.input.ended.1",
        "session.tool.called.1",
        "session.tool.progress.1",
        "session.tool.success.1",
        "session.tool.failed.1",
        "session.reasoning.started.1",
        "session.reasoning.ended.1",
        "session.retried.1",
        "session.compaction.started.1",
        "session.compaction.ended.1",
        "session.revert.staged.1",
        "session.revert.cleared.1",
        "session.revert.committed.1",
      ].toSorted(),
    )
    expect(SessionEvent.DurableDefinitions).toEqual(
      SessionEvent.Definitions.filter((definition) => definition.durability === "durable"),
    )
    expect(EventManifest.Definitions.every((definition) => definition.durability !== undefined)).toBe(true)
  })
})
