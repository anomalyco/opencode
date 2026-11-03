/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { SessionMessageInfo, SkillInfo } from "@opencode/client"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createStore, produce } from "solid-js/store"
import { SidebarSkills } from "../../src/feature-plugins/sidebar/skills"

const skill = (id: string, name: string, path: string): SkillInfo => ({
  id: id as SkillInfo["id"],
  name: name as SkillInfo["name"],
  path: path as SkillInfo["path"],
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

const skillCall = (id: string, name: string): SessionMessageInfo =>
  ({
    id: "message",
    type: "assistant",
    content: [
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
    ],
  }) as unknown as SessionMessageInfo

function context(options?: { skills?: SkillInfo[]; messages?: SessionMessageInfo[] }) {
  const color = RGBA.fromInts(200, 200, 200)
  const [view, setView] = createStore({ open: true })
  return {
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
        get: () => ({ location: { directory: "/workspace" } }),
        message: { list: () => options?.messages ?? [] },
      },
      location: {
        skill: { list: () => options?.skills ?? [] },
      },
    },
  } as unknown as Context
}

async function render(input: Context) {
  const app = await testRender(() => <SidebarSkills context={input} sessionID="session" />, {
    width: 42,
    height: 8,
  })
  await app.renderOnce()
  return app
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
      skills: [
        skill("effect", "Effect", "/workspace/.opencode/skills/effect/SKILL.md"),
        skill("unused", "Unused", "/workspace/.opencode/skills/unused/SKILL.md"),
      ],
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

test("sidebar marks built-in skills", async () => {
  const app = await render(
    context({
      skills: [skill("report", "Report", "skill://report/SKILL.md")],
      messages: [skillCall("report", "Report")],
    }),
  )

  try {
    expect(app.captureCharFrame()).toContain("Report built-in")
  } finally {
    app.renderer.destroy()
  }
})
