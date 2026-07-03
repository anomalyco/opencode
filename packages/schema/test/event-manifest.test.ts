import { describe, expect, test } from "bun:test"
import {
  Agent,
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
import { IdeEvent } from "../src/ide-event.js"
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
    expect(Agent.Event.Updated.durable).toBeUndefined()
    expect(EventManifest.Durable.has("agent.updated")).toBe(false)
  })

  test("uses canonical definitions for current public events", () => {
    expect(Session.Event).toBe(SessionEvent)
    expect(Session.Event.Definitions).toBe(SessionEvent.Definitions)
    expect(Workspace.Event).toBe(WorkspaceEvent)
    expect(Workspace.Event.Definitions).toBe(WorkspaceEvent.Definitions)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(SessionTodo.Event.Updated)
    expect(EventManifest.Latest.get("agent.updated")).toBe(Agent.Event.Updated)
    expect(EventManifest.Latest.get("project.updated")).toBe(Project.Event.Updated)
    expect(Agent.Event.Definitions).toEqual([Agent.Event.Updated])
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated])
    expect(FileSystem.Event.Definitions).toEqual([FileSystem.Event.Edited])
    expect(Integration.Event.Definitions).toEqual([Integration.Event.Updated, Integration.Event.ConnectionUpdated])
    expect(Permission.Event.Definitions).toEqual([Permission.Event.Asked, Permission.Event.Replied])
    expect(Form.Event.Definitions).toEqual([Form.Event.Created, Form.Event.Replied, Form.Event.Cancelled])
    expect(Reference.Event.Definitions).toEqual([Reference.Event.Updated])
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(IdeEvent.Definitions).toEqual([IdeEvent.Installed])
    const sessionV1TailStart = EventManifest.Definitions.indexOf(SessionV1.Event.PartDelta)
    expect(EventManifest.Definitions.slice(sessionV1TailStart, sessionV1TailStart + 3)).toEqual([
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
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
        "session.next.agent.switched.1",
        "session.next.model.switched.1",
        "session.next.moved.1",
        "session.next.renamed.1",
        "session.next.forked.1",
        "session.next.prompted.1",
        "session.next.prompt.admitted.1",
        "session.next.context.updated.1",
        "session.next.synthetic.1",
        "session.next.skill.activated.1",
        "session.next.shell.started.1",
        "session.next.shell.ended.1",
        "session.next.step.started.1",
        "session.next.step.ended.2",
        "session.next.step.failed.2",
        "session.next.text.started.1",
        "session.next.text.ended.1",
        "session.next.tool.input.started.1",
        "session.next.tool.input.ended.1",
        "session.next.tool.called.1",
        "session.next.tool.progress.1",
        "session.next.tool.success.1",
        "session.next.tool.failed.1",
        "session.next.reasoning.started.1",
        "session.next.reasoning.ended.1",
        "session.next.retried.1",
        "session.next.compaction.started.1",
        "session.next.compaction.ended.1",
        "session.next.revert.staged.1",
        "session.next.revert.cleared.1",
        "session.next.revert.committed.1",
      ].toSorted(),
    )
    expect(SessionEvent.DurableDefinitions).toEqual(
      SessionEvent.Definitions.filter((definition) => definition.durability === "durable"),
    )
    expect(EventManifest.Definitions.every((definition) => definition.durability !== undefined)).toBe(true)
  })
})
