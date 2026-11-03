/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { SessionMessageInfo, SkillInfo } from "@opencode/client"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { Path } from "@opencode/util/global"
import path from "path"
import { createStore, produce } from "solid-js/store"
import { SidebarSkills } from "../../src/feature-plugins/sidebar/skills"

const skill = (id: string, name: string, location: string): SkillInfo => ({
  id: id as SkillInfo["id"],
  name: name as SkillInfo["name"],
  path: location as SkillInfo["path"],
  content: "",
})

const projectSkill = (id: string, name: string) => skill(id, name, `/workspace/.opencode/skills/${id}/SKILL.md`)

const assistantMessage = (...content: unknown[]): SessionMessageInfo =>
  ({ id: "message", type: "assistant", content, time: { created: 0 } }) as unknown as SessionMessageInfo

const toolCall = (id: string, name: string, status = "completed"): SessionMessageInfo =>
  assistantMessage({
    type: "tool",
    id: `call_${id}`,
    name: "skill",
    state: {
      status,
      input: { id },
      content: [{ type: "text", text: `${name} instructions` }],
      metadata: { name },
    },
    time: { created: 0 },
  })

const promptAttachment = (id: string): SessionMessageInfo =>
  ({
    id: "user",
    type: "user",
    text: "Use this skill",
    skills: [{ id, name: id }],
    time: { created: 0 },
  }) as unknown as SessionMessageInfo

const loadedSkillMessage = (id: string, name: string): SessionMessageInfo =>
  ({
    id: "direct",
    type: "skill",
    skill: id,
    name,
    text: `${name} instructions`,
    time: { created: 0 },
  }) as unknown as SessionMessageInfo

function setup(skills: SkillInfo[], messages: SessionMessageInfo[]) {
  const color = RGBA.fromInts(200, 200, 200)
  const [view, setView] = createStore({ open: true })
  const [data, setData] = createStore({ messages })
  const context = {
    theme: { text: { base: color, muted: color, feedback: { success: { base: color } } } },
    storage: {
      store: () => [
        view,
        (mutation: (draft: { open: boolean }) => void) => {
          setView(produce(mutation))
          return Promise.resolve()
        },
      ],
    },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
        message: { list: () => data.messages },
      },
      location: { skill: { list: () => skills } },
    },
  } as unknown as Context
  return { context, setMessages: (messages: SessionMessageInfo[]) => setData("messages", messages) }
}

async function render(input: Context) {
  const app = await testRender(() => <SidebarSkills context={input} sessionID="session" />, {
    width: 42,
    height: 12,
  })
  await app.renderOnce()
  return app
}

const clickHeader = async (app: Awaited<ReturnType<typeof render>>) => {
  const rows = app.captureCharFrame().split("\n")
  const row = rows.findIndex((line) => line.includes("Active Skills"))
  await app.mockMouse.click(rows[row]!.indexOf("Active Skills") + 1, row)
  await app.renderOnce()
}

test("sidebar lists the skills the conversation loaded and labels their source", async () => {
  const app = await render(
    setup(
      [
        projectSkill("effect", "Effect"),
        skill("report", "Report", "skill://report/SKILL.md"),
        skill("global", "Global", path.join(Path.config, "skills/global/SKILL.md")),
        skill("external", "External", "/outside/skills/external/SKILL.md"),
        projectSkill("unused", "Unused"),
      ],
      [
        toolCall("effect", "Effect"),
        loadedSkillMessage("report", "Report"),
        promptAttachment("global"),
        toolCall("external", "External"),
      ],
    ).context,
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).toContain("Report built-in")
    expect(frame).toContain("Global global")
    expect(frame).toContain("External external")
    expect(frame).not.toContain("Unused")
    expect(frame).not.toContain("No skills loaded")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar ignores skill calls that never completed", async () => {
  const app = await render(
    setup(
      [projectSkill("effect", "Effect"), projectSkill("running", "Running"), projectSkill("failed", "Failed")],
      [
        toolCall("running", "Running", "running"),
        assistantMessage({
          type: "tool",
          id: "call_failed",
          name: "skill",
          state: { status: "error", input: { id: "failed" }, error: { type: "unknown", message: "load failed" } },
          time: { created: 0 },
        }),
        assistantMessage({ type: "text", text: "not a tool" }),
        toolCall("effect", "Effect"),
      ],
    ).context,
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("Running")
    expect(frame).not.toContain("Failed")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar updates as skills load", async () => {
  const state = setup([projectSkill("effect", "Effect")], [])
  const app = await render(state.context)

  try {
    expect(app.captureCharFrame()).toContain("No skills loaded")

    state.setMessages([toolCall("effect", "Effect")])
    await app.renderOnce()

    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("No skills loaded")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar collapses and expands when more than two skills are loaded", async () => {
  const app = await render(
    setup(
      [projectSkill("one", "One"), projectSkill("two", "Two"), projectSkill("three", "Three")],
      [toolCall("one", "One"), toolCall("two", "Two"), toolCall("three", "Three")],
    ).context,
  )

  try {
    expect(app.captureCharFrame()).toContain("▼")
    expect(app.captureCharFrame()).toContain("Three")

    await clickHeader(app)
    const collapsed = app.captureCharFrame()
    expect(collapsed).toContain("▶")
    expect(collapsed).not.toContain("Three")

    await clickHeader(app)
    expect(app.captureCharFrame()).toContain("▼")
    expect(app.captureCharFrame()).toContain("Three")
  } finally {
    app.renderer.destroy()
  }
})
