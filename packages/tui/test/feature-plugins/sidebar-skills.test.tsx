/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { SessionMessageInfo, SkillInfo } from "@opencode/client"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { Path } from "@opencode/util/global"
import path from "path"
import type { JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import SidebarSkillsPlugin, { SidebarSkills } from "../../src/feature-plugins/sidebar/skills"

const skill = (id: string, name: string, location: string): SkillInfo => ({
  id: id as SkillInfo["id"],
  name: name as SkillInfo["name"],
  path: location as SkillInfo["path"],
  content: "",
})

const skillAttachment = (id: string): SessionMessageInfo =>
  ({
    id: "user",
    type: "user",
    text: "Use this skill",
    skills: [{ id, name: id }],
    time: { created: 0 },
  }) as unknown as SessionMessageInfo

const skillMessage = (id: string, name: string): SessionMessageInfo =>
  ({
    id: "direct",
    type: "skill",
    skill: id,
    name,
    text: `${name} instructions`,
    time: { created: 0 },
  }) as unknown as SessionMessageInfo

const assistantMessage = (content: unknown[]): SessionMessageInfo =>
  ({
    id: "message",
    type: "assistant",
    content,
    time: { created: 0 },
  }) as unknown as SessionMessageInfo

const skillCall = (id: string, name: string): SessionMessageInfo =>
  assistantMessage([
    {
      type: "tool",
      id: "call",
      name: "skill",
      state: {
        status: "completed",
        input: { id },
        content: [{ type: "text", text: `${name} instructions` }],
        metadata: { name },
      },
      time: { created: 0 },
    },
  ])

type ContextOptions = {
  skills?: SkillInfo[]
  messages?: SessionMessageInfo[]
  sessionPermissions?: unknown[]
  agentPermissions?: unknown[]
}

function contextWith(options?: ContextOptions) {
  const color = RGBA.fromInts(200, 200, 200)
  const [view, setView] = createStore({ open: true })
  const [data, setData] = createStore({
    skills: options?.skills ?? [],
    messages: options?.messages ?? [],
  })
  const context = {
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: { success: { base: color } },
      },
    },
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
        get: () => ({
          location: { directory: "/workspace" },
          agent: "build",
          permissions: options?.sessionPermissions,
        }),
        message: { list: () => data.messages },
      },
      location: {
        agent: { list: () => [{ id: "build", permissions: options?.agentPermissions ?? [] }] },
        skill: { list: () => data.skills },
      },
    },
  } as unknown as Context
  return { context, setData }
}

function context(options?: ContextOptions) {
  return contextWith(options).context
}

async function render(input: Context) {
  const app = await testRender(() => <SidebarSkills context={input} sessionID="session" />, {
    width: 42,
    height: 12,
  })
  await app.renderOnce()
  return app
}

const projectSkill = (id: string, name: string) => skill(id, name, `/workspace/.opencode/skills/${id}/SKILL.md`)

const clickHeader = async (app: Awaited<ReturnType<typeof render>>) => {
  const rows = app.captureCharFrame().split("\n")
  const row = rows.findIndex((line) => line.includes("Active Skills"))
  await app.mockMouse.click(rows[row]!.indexOf("Active Skills") + 1, row)
  await app.renderOnce()
}

test("sidebar starts with an empty active skills list", async () => {
  const app = await render(context())

  try {
    expect(app.captureCharFrame()).toContain("Active Skills")
    expect(app.captureCharFrame()).toContain("No skills loaded")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar lists only skills the session loaded", async () => {
  const app = await render(
    context({
      skills: [projectSkill("effect", "Effect"), projectSkill("unused", "Unused")],
      messages: [skillAttachment("effect"), skillCall("effect", "Effect")],
    }),
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("Unused")
    expect(frame).not.toContain("No skills loaded")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar omits a loaded skill that is no longer available", async () => {
  const app = await render(
    context({
      skills: [projectSkill("effect", "Effect")],
      messages: [skillCall("removed", "Removed"), skillCall("effect", "Effect")],
    }),
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("Removed")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar keeps a loaded skill visible after a permission change", async () => {
  // The skill's content is already in message history, so the panel reports
  // conversation state rather than the current permission policy.
  const app = await render(
    context({
      skills: [projectSkill("effect", "Effect")],
      messages: [skillCall("effect", "Effect")],
      sessionPermissions: [{ action: "skill", resource: "*", effect: "deny" }],
      agentPermissions: [{ action: "skill", resource: "effect", effect: "deny" }],
    }),
  )

  try {
    expect(app.captureCharFrame()).toContain("Effect project")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar reads skills activated directly", async () => {
  const app = await render(
    context({
      skills: [projectSkill("effect", "Effect"), projectSkill("unused", "Unused")],
      messages: [skillMessage("effect", "Effect")],
    }),
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("Unused")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar ignores running, failed, and malformed skill calls", async () => {
  const app = await render(
    context({
      skills: [
        projectSkill("effect", "Effect"),
        projectSkill("running", "Running"),
        projectSkill("failed", "Failed"),
        projectSkill("malformed", "Malformed"),
      ],
      messages: [
        assistantMessage([
          {
            type: "tool",
            id: "call-running",
            name: "skill",
            state: { status: "running", input: { id: "running" }, metadata: {} },
            time: { created: 0 },
          },
        ]),
        assistantMessage([
          {
            type: "tool",
            id: "call-failed",
            name: "skill",
            state: {
              status: "error",
              input: { id: "failed" },
              error: { type: "unknown", message: "load failed" },
            },
            time: { created: 0 },
          },
        ]),
        assistantMessage([
          {
            type: "tool",
            id: "call-malformed",
            name: "skill",
            state: { status: "completed", input: { id: 42 }, content: [{ type: "text", text: "bad" }] },
            time: { created: 0 },
          },
        ]),
        assistantMessage([{ type: "text", text: "not a tool" }]),
        skillCall("effect", "Effect"),
      ],
    }),
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("Running")
    expect(frame).not.toContain("Failed")
    expect(frame).not.toContain("Malformed")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar labels built-in, global, and external skills", async () => {
  const app = await render(
    context({
      skills: [
        skill("report", "Report", "skill://report/SKILL.md"),
        skill("global", "Global", path.join(Path.config, "skills/global/SKILL.md")),
        skill("external", "External", "/outside/skills/external/SKILL.md"),
      ],
      messages: [skillCall("report", "Report"), skillCall("global", "Global"), skillCall("external", "External")],
    }),
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Report built-in")
    expect(frame).toContain("Global global")
    expect(frame).toContain("External external")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar collapses and expands when more than two skills are loaded", async () => {
  const app = await render(
    context({
      skills: [projectSkill("one", "One"), projectSkill("two", "Two"), projectSkill("three", "Three")],
      messages: [skillCall("one", "One"), skillCall("two", "Two"), skillCall("three", "Three")],
    }),
  )

  try {
    expect(app.captureCharFrame()).toContain("▼")
    expect(app.captureCharFrame()).toContain("Three")

    await clickHeader(app)
    const collapsed = app.captureCharFrame()
    expect(collapsed).toContain("▶")
    expect(collapsed).not.toContain("One")
    expect(collapsed).not.toContain("Three")

    await clickHeader(app)
    expect(app.captureCharFrame()).toContain("▼")
    expect(app.captureCharFrame()).toContain("Three")
  } finally {
    app.renderer.destroy()
  }
})

test("plugin registers and renders the sidebar content slot", async () => {
  const claims: unknown[] = []
  let render: (() => JSX.Element) | undefined
  const configured = {
    ...context(),
    ui: {
      slot: (claim: unknown) => {
        claims.push(claim)
        const slot = claim as { render: (input: { sessionID: string }) => JSX.Element }
        render = () => slot.render({ sessionID: "session" })
        return () => {}
      },
    },
  } as unknown as Context

  await SidebarSkillsPlugin.setup(configured)

  expect(SidebarSkillsPlugin.id).toBe("opencode.sidebar.skills")
  expect(claims).toMatchObject([{ append: "sidebar.content" }])

  const app = await testRender(render!, { width: 42, height: 8 })
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Active Skills")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar updates as skills load", async () => {
  const state = contextWith({ skills: [projectSkill("effect", "Effect"), projectSkill("unused", "Unused")] })
  const app = await render(state.context)

  try {
    expect(app.captureCharFrame()).toContain("No skills loaded")

    state.setData("messages", [skillAttachment("effect"), skillCall("effect", "Effect")])
    await app.renderOnce()

    const frame = app.captureCharFrame()
    expect(frame).toContain("Effect project")
    expect(frame).not.toContain("No skills loaded")
  } finally {
    app.renderer.destroy()
  }
})
