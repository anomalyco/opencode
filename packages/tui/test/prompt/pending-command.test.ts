import type { SessionMessage } from "@opencode/schema/session-message"
import type { PendingCommand } from "../../src/component/prompt/pending-command"
import { Session } from "@opencode/schema/session"
import { describe, expect, test } from "bun:test"
import { formatPendingCommandText, PendingCommands } from "../../src/component/prompt/pending-command"
import { Skill } from "@opencode/schema/skill"
import type { PromptInfo } from "../../src/prompt/history"

describe("pending slash commands", () => {
  test("adds and lists pending commands for a session", () => {
    PendingCommands.clear(Session.ID.make("ses_1", { disableChecks: true }))

    const cmd = PendingCommands.add({
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      name: "mcp-prompt",
      arguments: "arg1 arg2",
      delivery: "steer",
    })

    expect(cmd.id).toBeDefined()
    expect(cmd.name).toBe("mcp-prompt")
    expect(cmd.arguments).toBe("arg1 arg2")
    expect(cmd.delivery).toBe("steer")

    const list = PendingCommands.list(Session.ID.make("ses_1", { disableChecks: true }))
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(cmd)

    PendingCommands.remove(cmd.id, Session.ID.make("ses_1", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_1", { disableChecks: true }))).toHaveLength(0)
  })

  test("preserves attachments, agents, skills, and delivery mode", () => {
    PendingCommands.clear(Session.ID.make("ses_attachments", { disableChecks: true }))

    const files: PromptInfo["files"] = [{ uri: "file:///test.txt", name: "test.txt" }]
    const agents: PromptInfo["agents"] = [{ name: "builder" }]
    const skills: PromptInfo["skills"] = [{ id: Skill.ID.make("skill_1") }]

    const cmd = PendingCommands.add({
      sessionID: Session.ID.make("ses_attachments", { disableChecks: true }),
      name: "review-code",
      arguments: "--verbose",
      delivery: "queue",
      files,
      agents,
      skills,
    })

    expect(cmd.files).toEqual(files)
    expect(cmd.agents).toEqual(agents)
    expect(cmd.skills).toEqual(skills)
    expect(cmd.delivery).toBe("queue")

    PendingCommands.clear(Session.ID.make("ses_attachments", { disableChecks: true }))
  })

  test("isolates pending commands across multiple sessions", () => {
    PendingCommands.clear(Session.ID.make("ses_a", { disableChecks: true }))
    PendingCommands.clear(Session.ID.make("ses_b", { disableChecks: true }))

    const cmdA = PendingCommands.add({
      sessionID: Session.ID.make("ses_a", { disableChecks: true }),
      name: "cmd-a",
      delivery: "steer",
    })

    const cmdB = PendingCommands.add({
      sessionID: Session.ID.make("ses_b", { disableChecks: true }),
      name: "cmd-b",
      delivery: "steer",
    })

    expect(PendingCommands.list(Session.ID.make("ses_a", { disableChecks: true }))).toEqual([cmdA])
    expect(PendingCommands.list(Session.ID.make("ses_b", { disableChecks: true }))).toEqual([cmdB])
    expect(PendingCommands.list(Session.ID.make("ses_c", { disableChecks: true }))).toEqual([])

    PendingCommands.remove(cmdA.id, Session.ID.make("ses_a", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_a", { disableChecks: true }))).toEqual([])
    expect(PendingCommands.list(Session.ID.make("ses_b", { disableChecks: true }))).toEqual([cmdB])

    PendingCommands.remove(cmdB.id, Session.ID.make("ses_b", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_b", { disableChecks: true }))).toEqual([])
  })

  test("handles multiple concurrent submissions in the same session without colliding", () => {
    PendingCommands.clear(Session.ID.make("ses_multi", { disableChecks: true }))

    const cmd1 = PendingCommands.add({
      sessionID: Session.ID.make("ses_multi", { disableChecks: true }),
      name: "mcp-slow-1",
      arguments: "first",
      delivery: "steer",
    })

    const cmd2 = PendingCommands.add({
      sessionID: Session.ID.make("ses_multi", { disableChecks: true }),
      name: "mcp-slow-2",
      arguments: "second",
      delivery: "steer",
    })

    const cmd3 = PendingCommands.add({
      sessionID: Session.ID.make("ses_multi", { disableChecks: true }),
      name: "mcp-slow-1", // repeated submission of same command name
      arguments: "third",
      delivery: "queue",
    })

    expect(cmd1.id).not.toBe(cmd2.id)
    expect(cmd1.id).not.toBe(cmd3.id)

    expect(PendingCommands.list(Session.ID.make("ses_multi", { disableChecks: true }))).toEqual([cmd1, cmd2, cmd3])

    // Removing cmd2 leaves cmd1 and cmd3
    PendingCommands.remove(cmd2.id, Session.ID.make("ses_multi", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_multi", { disableChecks: true }))).toEqual([cmd1, cmd3])

    // Removing cmd1 leaves cmd3
    PendingCommands.remove(cmd1.id, Session.ID.make("ses_multi", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_multi", { disableChecks: true }))).toEqual([cmd3])

    PendingCommands.remove(cmd3.id, Session.ID.make("ses_multi", { disableChecks: true }))
    expect(PendingCommands.list(Session.ID.make("ses_multi", { disableChecks: true }))).toEqual([])
  })

  test("formats pending command display text correctly for various options", () => {
    expect(
      formatPendingCommandText({
        id: "1",
        sessionID: Session.ID.make("s", { disableChecks: true }),
        name: "test-cmd",
        delivery: "steer",
      }),
    ).toBe("Resolving /test-cmd…")

    expect(
      formatPendingCommandText({
        id: "2",
        sessionID: Session.ID.make("s", { disableChecks: true }),
        name: "test-cmd",
        arguments: "arg1 arg2",
        delivery: "steer",
      }),
    ).toBe("Resolving /test-cmd arg1 arg2…")

    expect(
      formatPendingCommandText({
        id: "3",
        sessionID: Session.ID.make("s", { disableChecks: true }),
        name: "test-cmd",
        arguments: "arg1",
        delivery: "queue",
      }),
    ).toBe("Resolving /test-cmd arg1 (queue)…")

    expect(
      formatPendingCommandText(
        {
          id: "4",
          sessionID: Session.ID.make("s", { disableChecks: true }),
          name: "test-cmd",
          delivery: "steer",
        },
        3,
      ),
    ).toBe("Resolving /test-cmd (+3 more)…")
  })
})

// These assertions target the production API so widening a Session boundary breaks typecheck.
type Assert<T extends true> = T
export type PendingCommandSessionBoundary = [
  Assert<SessionMessage.ID extends PendingCommand["sessionID"] ? false : true>,
  Assert<SessionMessage.ID extends Parameters<typeof PendingCommands.list>[0] ? false : true>,
  Assert<SessionMessage.ID extends Parameters<typeof PendingCommands.add>[0]["sessionID"] ? false : true>,
  Assert<SessionMessage.ID extends Parameters<typeof PendingCommands.remove>[1] ? false : true>,
  Assert<SessionMessage.ID extends Parameters<typeof PendingCommands.clear>[0] ? false : true>,
  Assert<string extends Parameters<typeof PendingCommands.list>[0] ? false : true>,
  Assert<string extends Parameters<typeof PendingCommands.add>[0]["sessionID"] ? false : true>,
  Assert<string extends Parameters<typeof PendingCommands.remove>[1] ? false : true>,
  Assert<string extends Parameters<typeof PendingCommands.clear>[0] ? false : true>,
  Assert<string extends PendingCommand["id"] ? true : false>,
  Assert<string extends Parameters<typeof PendingCommands.remove>[0] ? true : false>,
]
