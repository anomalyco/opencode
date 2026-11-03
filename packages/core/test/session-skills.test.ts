import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai/effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSkills } from "@opencode/core/session/skills"
import { Skill } from "@opencode/schema/skill"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)

const skillMessage = (id: string, name: string) =>
  SessionMessage.Skill.make({
    id: SessionMessage.ID.make(`msg_${id}`),
    type: "skill",
    skill: Skill.ID.make(id),
    name: Skill.Name.make(name),
    text: `${name} instructions`,
    time: { created },
  })

const skillTool = (id: string, name: string, status: "completed" | "error" = "completed") =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id: `call_${id}`,
    name: "skill",
    state:
      status === "completed"
        ? SessionMessage.ToolStateCompleted.make({
            status: "completed",
            input: { id },
            content: [{ type: "text", text: `${name} instructions` }],
            metadata: { name },
          })
        : SessionMessage.ToolStateError.make({
            status: "error",
            input: { id },
            error: { type: "unknown", message: "load failed" },
          }),
    time: { created },
  })

const userSkill = (id: string, name: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text: "Use this skill",
    skills: [{ id: Skill.ID.make(id), name: Skill.Name.make(name) }],
    time: { created },
  })

const assistant = (content: SessionMessage.Assistant["content"]): SessionMessage.Assistant =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
    content,
    time: { created },
  })

describe("SessionSkills.loaded", () => {
  test("collects skills loaded by the tool and attached directly to a prompt", () => {
    const messages: SessionMessage.Info[] = [
      skillMessage("effect", "Effect"),
      userSkill("direct", "Direct"),
      assistant([skillTool("clickcast", "Clickcast")]),
    ]

    expect(SessionSkills.loaded(messages, [])).toEqual([
      { id: "effect", name: "Effect" },
      { id: "direct", name: "Direct" },
      { id: "clickcast", name: "Clickcast" },
    ])
  })

  test("keeps the first name when the same skill is loaded repeatedly", () => {
    const messages: SessionMessage.Info[] = [
      assistant([skillTool("effect", "Effect")]),
      assistant([skillTool("effect", "Effect renamed")]),
    ]

    expect(SessionSkills.loaded(messages, [])).toEqual([{ id: "effect", name: "Effect" }])
  })

  test("ignores failed loads and unrelated tools, and deduplicates repeated loads", () => {
    const messages: SessionMessage.Info[] = [
      assistant([skillTool("effect", "Effect"), skillTool("broken", "Broken", "error")]),
      assistant([skillTool("effect", "Effect")]),
      assistant([
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "call_read",
          name: "read",
          state: SessionMessage.ToolStateCompleted.make({
            status: "completed",
            input: { path: "README.md" },
            content: [{ type: "text", text: "README" }],
          }),
          time: { created },
        }),
      ]),
    ]

    expect(SessionSkills.loaded(messages, [])).toEqual([{ id: "effect", name: "Effect" }])
  })

  test("omits skills denied by the current rules", () => {
    const messages: SessionMessage.Info[] = [
      skillMessage("effect", "Effect"),
      assistant([skillTool("clickcast", "Clickcast")]),
    ]

    expect(SessionSkills.loaded(messages, [{ action: "skill", resource: "effect", effect: "deny" }])).toEqual([
      { id: "clickcast", name: "Clickcast" },
    ])
    expect(
      SessionSkills.loaded(messages, Permission.merge([{ action: "skill", resource: "*", effect: "deny" }])),
    ).toEqual([])
    expect(
      SessionSkills.loaded(
        messages,
        Permission.merge([
          { action: "skill", resource: "*", effect: "deny" },
          { action: "skill", resource: "effect", effect: "allow" },
        ]),
      ),
    ).toEqual([{ id: "effect", name: "Effect" }])
  })
})

describe("SessionSkills.render", () => {
  test("names each loaded skill and discourages loading it again", () => {
    expect(SessionSkills.render([{ id: "effect", name: "Effect" }])).toBe(
      [
        "<loaded_skills>",
        "These skills are already in this conversation. Their content is in the message history. Do not load them again — reference the existing content directly.",
        "  <skill>Effect</skill>",
        "</loaded_skills>",
      ].join("\n"),
    )
  })
})

describe("SessionSkills.remind", () => {
  test("appends the reminder after the messages so the cached prefix survives", () => {
    const messages = [Message.user("Continue")]

    expect(SessionSkills.remind(messages, [])).toEqual(messages)
    const reminded = SessionSkills.remind(messages, [{ id: "effect", name: "Effect" }])
    expect(reminded).toHaveLength(2)
    expect(JSON.stringify(reminded.at(-1))).toContain("<skill>Effect</skill>")
  })
})
