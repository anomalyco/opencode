/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, type RootRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { FormInfo } from "@opencode-ai/client/promise"
import { Keymap } from "../../src/context/keymap"
import {
  RUN_COMMAND_PANEL_ROWS,
  RUN_SUBAGENT_PANEL_ROWS,
  RunAgentSelectBody,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSettingsBody,
  RunSkillSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "../../src/mini/footer.command"
import { RunFooterView } from "../../src/mini/footer.view"
import { RunEntryContent } from "../../src/mini/scrollback.writer"
import { RUN_THEME_FALLBACK, type RunTheme } from "../../src/mini/theme"
import type {
  FooterState,
  FooterSubagentState,
  FooterSubagentTab,
  FooterView,
  MiniSettingChange,
  MiniSettings,
  RunAgent,
  RunCommand,
  RunInput,
  RunPrompt,
  RunProvider,
  RunTuiConfig,
  StreamCommit,
} from "../../src/mini/types"
import { selectedCommand } from "../../src/mini/footer.prompt"
import { RejectField } from "../../src/mini/footer.permission"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const tuiConfig = createTuiResolvedConfig()

function command(input: { name: string; description: string; source?: "command" | "mcp" | "skill" }) {
  return {
    name: input.name,
    description: input.description,
    source: input.source,
  } satisfies RunCommand
}

function model(input: {
  id: string
  name: string
  status?: "active" | "deprecated"
  cost?: number
  variants?: Record<string, Record<string, never>>
}) {
  return {
    name: input.name,
    cost: {
      input: input.cost ?? 1,
    },
    status: input.status ?? "active",
    variants: input.variants,
  } satisfies RunProvider["models"][string]
}

function provider() {
  return {
    id: "opencode",
    name: "opencode",
    models: {
      "gpt-5": model({ id: "gpt-5", name: "GPT-5", variants: { high: {}, minimal: {} } }),
      "gpt-free": model({ id: "gpt-free", name: "GPT Free", cost: 0 }),
      old: model({ id: "old", name: "Old Model", status: "deprecated" }),
    },
  } satisfies RunProvider
}

function subagent(input: {
  sessionID: string
  label: string
  description: string
  status?: FooterSubagentTab["status"]
}) {
  return {
    sessionID: input.sessionID,
    label: input.label,
    description: input.description,
    status: input.status ?? "running",
  } satisfies FooterSubagentTab
}

function footerState(input: Partial<FooterState> = {}) {
  return createSignal<FooterState>({
    phase: "idle",
    status: "",
    notice: "",
    model: "gpt-5",
    usage: "",
    first: false,
    interrupt: 0,
    exit: 0,
    ...input,
  })
}

async function renderFooter(
  input: {
    tuiConfig?: RunTuiConfig
    commands?: RunCommand[]
    theme?: () => RunTheme
    providers?: RunProvider[]
    currentAgent?: string
    currentModel?: RunInput["model"]
    currentVariant?: string
    subagents?: FooterSubagentState
    width?: number
    height?: number
    state?: Partial<FooterState>
    onCycle?: () => void
    onSubmit?: (prompt: RunPrompt) => boolean
    view?: FooterView
    onFormReply?: (input: unknown) => void
    miniSettings?: MiniSettings
    mono?: boolean
    onStatus?: (status: string) => void
    onMiniSettingChange?: (change: MiniSettingChange) => void
  } = {},
) {
  const [view, setView] = createSignal<FooterView>(input.view ?? { type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>(
    input.subagents ?? { tabs: [], details: {}, permissions: [], forms: [] },
  )
  const [state, setState] = footerState(input.state)
  const config = input.tuiConfig ?? tuiConfig
  const [miniSettings] = createSignal<MiniSettings>(
    input.miniSettings ?? {
      thinking: "hide",
      shell_output: "hide",
      turn_summary: "show",
      footer: "show",
      splash: "show",
      mono: false,
    },
  )
  function Harness() {
    return (
      <Keymap.Provider config={config}>
        <RunFooterView
          directory={() => "/tmp"}
          findFiles={async () => []}
          agents={() => []}
          references={() => []}
          commands={() => input.commands ?? []}
          providers={() => input.providers}
          currentAgent={() => input.currentAgent ?? "Build"}
          currentAgentID={() => input.currentAgent?.toLowerCase() ?? "build"}
          currentModel={() => input.currentModel}
          variants={() => []}
          currentVariant={() => input.currentVariant}
          state={state}
          view={view}
          subagent={subagents}
          theme={input.theme ?? (() => RUN_THEME_FALLBACK)}
          mono={input.mono ?? false}
          miniSettings={miniSettings}
          onSubmit={input.onSubmit ?? (() => true)}
          onPermissionReply={() => {}}
          onFormReply={(value) => input.onFormReply?.(value)}
          onFormCancel={() => {}}
          onCycle={input.onCycle ?? (() => {})}
          onInterrupt={() => false}
          onEditorOpen={async () => undefined}
          onInputClear={() => {}}
          onExit={() => {}}
          onAgentSelect={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={(status) => input.onStatus?.(status)}
          onMiniSettingChange={(change) => input.onMiniSettingChange?.(change)}
        />
      </Keymap.Provider>
    )
  }

  const app = await testRender(
    () => (
      <box width={input.width ?? 100} height={input.height ?? 8}>
        <Harness />
      </box>
    ),
    { width: input.width ?? 100, height: input.height ?? 8, kittyKeyboard: true },
  )

  return {
    ...app,
    setView,
    setState,
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      app.renderer.destroy()
    },
  }
}

test("direct footer shows the generic default model before resolution", async () => {
  const app = await renderFooter({ state: { model: "Default model" } })
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Default model")
  } finally {
    app.cleanup()
  }
})

test("direct footer preserves a partial multi-field form draft across permission preemption", async () => {
  const request: FormInfo = {
    id: "frm_preempted",
    sessionID: "ses_child",
    title: "Deployment",
    fields: [
      { key: "service", type: "string", title: "Service", required: true },
      { key: "notes", type: "string", title: "Notes", required: true },
    ],
  }
  const app = await renderFooter({
    height: 16,
    view: { type: "form", request },
  })

  try {
    await app.renderOnce()
    "api".split("").forEach((key) => app.mockInput.pressKey(key))
    app.mockInput.pressEnter()
    await app.renderOnce()
    "keep this draft".split("").forEach((key) => app.mockInput.pressKey(key))
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("keep this draft")

    app.setView({
      type: "permission",
      request: {
        id: "per_preempting",
        sessionID: "ses_child",
        action: "read",
        resources: ["src/index.ts"],
      },
    })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Permission required")

    app.setView({ type: "form", request })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("2/2")
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("keep this draft")

    app.setView({ type: "prompt" })
    await app.renderOnce()
    app.setView({ type: "form", request })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("1/2")
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("")
  } finally {
    app.cleanup()
  }
})

function expectPaletteList(list: BoxRenderable, selectedIndex: number) {
  expect(list.backgroundColor.toInts()).toEqual((RUN_THEME_FALLBACK.footer.shade as RGBA).toInts())
  expect((list.getChildren()[selectedIndex] as BoxRenderable).backgroundColor.toInts()).toEqual(
    (RUN_THEME_FALLBACK.footer.selected as RGBA).toInts(),
  )
}

function child(root: BoxRenderable | RootRenderable, index: number) {
  return root.getChildren()[index] as BoxRenderable
}

function boxPath(root: BoxRenderable | RootRenderable, name: string): BoxRenderable[] | undefined {
  for (const item of root.getChildren()) {
    if (item.constructor.name === name) return root instanceof BoxRenderable ? [root] : []
    if (!(item instanceof BoxRenderable)) continue
    const path = boxPath(item, name)
    if (path) return root instanceof BoxRenderable ? [root, ...path] : path
  }
}

function footerComposerFrame(root: BoxRenderable | RootRenderable) {
  return boxPath(root, "TextareaRenderable")!.at(-5)!
}

function footerStatusline(root: BoxRenderable | RootRenderable) {
  const status = (RUN_THEME_FALLBACK.footer.status as RGBA).toInts()
  const boxes = root.getChildren().filter((item): item is BoxRenderable => item instanceof BoxRenderable)
  for (const box of boxes) {
    if (box.backgroundColor?.toInts().every((value, index) => value === status[index])) return box
    boxes.push(...box.getChildren().filter((item): item is BoxRenderable => item instanceof BoxRenderable))
  }
  throw new Error("Footer statusline not found")
}

function panelMenu(root: BoxRenderable | RootRenderable) {
  const panel = child(child(root, 0), 0)
  const content = child(panel, 0)
  return child(content.getChildren().at(-1) as BoxRenderable, 0)
}

test("direct footer composer area does not adopt footer surface", async () => {
  const surface = RGBA.fromHex("#123456")
  const [theme, setTheme] = createSignal(RUN_THEME_FALLBACK)
  const app = await renderFooter({ theme })

  try {
    await app.renderOnce()
    const area = child(footerComposerFrame(app.renderer.root), 0)

    expect(area.backgroundColor.toInts()).not.toEqual(surface.toInts())
    setTheme({
      ...RUN_THEME_FALLBACK,
      footer: {
        ...RUN_THEME_FALLBACK.footer,
        surface,
      },
    })
    await app.renderOnce()

    expect(area.backgroundColor.toInts()).not.toEqual(surface.toInts())
  } finally {
    app.cleanup()
  }
})

test("run entry content updates when live commit text changes", async () => {
  const [commit, setCommit] = createSignal<StreamCommit>({
    kind: "tool",
    text: "I",
    phase: "progress",
    source: "tool",
    messageID: "msg-1",
    partID: "part-1",
    tool: "shell",
  })

  const app = await testRender(
    () => (
      <box width={80} height={4}>
        <RunEntryContent commit={commit()} theme={RUN_THEME_FALLBACK} />
      </box>
    ),
    {
      width: 80,
      height: 4,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("I")

    setCommit({
      kind: "tool",
      text: "I need to inspect the codebase",
      phase: "progress",
      source: "tool",
      messageID: "msg-1",
      partID: "part-1",
      tool: "shell",
    })
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("I need to inspect the codebase")
  } finally {
    app.renderer.destroy()
  }
})

test("direct command panel renders grouped actions without catalog commands", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([
    command({ name: "review", description: "Review code" }),
    command({ name: "deploy", description: "Deploy prompt", source: "mcp" }),
    command({ name: "internal", description: "Skill command", source: "skill" }),
  ])
  const [subagents] = createSignal([])
  const [variants] = createSignal(["high", "minimal"])
  let status = 0

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunCommandMenuBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          subagents={subagents}
          queued={() => []}
          variants={variants}
          variantCycle="ctrl+t"
          onClose={() => {}}
          onAgent={() => {}}
          onModel={() => {}}
          onEditor={() => {}}
          onSkill={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
          onStatus={() => status++}
          onSettings={() => {}}
          onCommand={() => {}}
          onNew={() => {}}
          onExit={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("Commands")
    expect(frame).toMatch(/^ {2}Commands/m)
    expect(frame).toContain("Search")
    expect(frame).toContain("Session")
    expect(frame).toContain("Agent")
    expect(frame).toContain("Prompt")
    expect(frame).toContain("Open editor")
    expect(frame).toContain("/editor")
    expect(frame).toContain("Show status")
    expect(frame).toContain("Compact session")
    expect(frame).toContain("/compact")
    expect(frame).toContain("Skills")
    expect(frame).toContain("/skills")
    expect(frame.match(/\bAgent\b/g)?.length).toBe(1)
    expect(frame).not.toContain("┌")
    expect(frame).not.toContain("┃")
    expect(frame).not.toContain("/internal")
    expect(frame).not.toContain("Choose model for future turns")
    expect(frame).not.toContain("Cycle reasoning effort for future turns")
    expect(frame).not.toContain("Review code")
    expect(frame).not.toContain("Commands 8")

    await app.mockInput.typeText("agent")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Switch agent")

    app.mockInput.pressKey("u", { ctrl: true })
    await app.mockInput.typeText("review")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("No results found")

    app.mockInput.pressKey("u", { ctrl: true })
    await app.mockInput.typeText("deploy")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("No results found")

    app.mockInput.pressKey("u", { ctrl: true })
    await app.mockInput.typeText("status")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Show status")
    app.mockInput.pressEnter()
    expect(status).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("direct settings panel changes Mini transcript preferences", async () => {
  const [settings, setSettings] = createSignal<MiniSettings>({
    thinking: "hide",
    shell_output: "hide",
    turn_summary: "show",
    footer: "show",
    splash: "show",
    mono: false,
  })
  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunSettingsBody
          theme={() => RUN_THEME_FALLBACK.footer}
          settings={settings}
          onClose={() => {}}
          onChange={(change) => {
            setSettings((current) => ({ ...current, [change.key]: change.value }))
          }}
          mono
        />
      </box>
    ),
    { width: 100, height: RUN_COMMAND_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Settings")
    expect(frame).toMatch(/^ Settings/m)
    expect(frame).toContain("Thinking")
    expect(frame).toContain("Shell")
    expect(frame).toContain("Turn summary")
    expect(frame).toContain("Footer details")
    expect(frame).toContain("Splash")
    expect(frame).toContain("Monochrome UI")
    expect(frame).toContain("left/right change")
    expect(frame).not.toMatch(/[^\x00-\x7F]/)

    app.mockInput.pressKey("ARROW_RIGHT")
    await app.renderOnce()

    expect(settings()).toEqual({
      thinking: "show",
      shell_output: "hide",
      turn_summary: "show",
      footer: "show",
      splash: "show",
      mono: false,
    })

    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_RIGHT")
    await app.renderOnce()

    expect(settings()).toEqual({
      thinking: "show",
      shell_output: "hide",
      turn_summary: "hide",
      footer: "show",
      splash: "show",
      mono: false,
    })

    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_RIGHT")
    await app.renderOnce()
    expect(settings().splash).toBe("hide")

    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_RIGHT")
    await app.renderOnce()
    expect(settings().mono).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("direct skill panel renders searchable skill list", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([
    command({ name: "review", description: "Review code" }),
    command({ name: "internal", description: "Skill command", source: "skill" }),
    command({ name: "formatter", description: "Apply formatter fixes", source: "skill" }),
  ])
  const selected: string[] = []

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunSkillSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          onClose={() => {}}
          onSelect={(name) => {
            selected.push(name)
          }}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("Skills")
    expect(frame).toContain("Search")
    expect(frame).toContain("internal")
    expect(frame).not.toContain("/internal")
    expect(frame).toContain("formatter")
    expect(frame).toContain("Apply formatter fixes")
    expect(frame).not.toContain("review")
    await app.mockInput.typeText("format")
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("internal")
    app.mockInput.pressEnter()
    expect(selected).toEqual(["formatter"])
  } finally {
    app.renderer.destroy()
  }
})

test("direct skill panel truncates long descriptions from the end", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([
    command({
      name: "terminal-control",
      description:
        "Control and test terminal applications, REPLs, interactive CLIs, shell processes, OpenTUI applications, or other terminal-backed workflows.",
      source: "skill",
    }),
  ])

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunSkillSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          onClose={() => {}}
          onSelect={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("terminal-control")
    expect(frame).toContain("Control and test terminal applications")
    expect(frame).not.toMatch(/application(?:…|\.\.\.)ocess/)
  } finally {
    app.renderer.destroy()
  }
})

test("direct command panel shows subagent entry when available", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([])
  const [subagents] = createSignal([subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" })])
  const [variants] = createSignal<string[]>([])

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunCommandMenuBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          subagents={subagents}
          queued={() => []}
          variants={variants}
          variantCycle="ctrl+t"
          onClose={() => {}}
          onAgent={() => {}}
          onModel={() => {}}
          onEditor={() => {}}
          onSkill={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
          onStatus={() => {}}
          onSettings={() => {}}
          onCommand={() => {}}
          onNew={() => {}}
          onExit={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("View subagents")
    expect(frame).toContain("1 active")
  } finally {
    app.renderer.destroy()
  }
})

test("direct command panel keeps completed subagents available", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([])
  const [subagents] = createSignal([
    subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow", status: "completed" }),
  ])
  const [variants] = createSignal<string[]>([])

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunCommandMenuBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          subagents={subagents}
          queued={() => []}
          variants={variants}
          variantCycle="ctrl+t"
          onClose={() => {}}
          onAgent={() => {}}
          onModel={() => {}}
          onEditor={() => {}}
          onSkill={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
          onStatus={() => {}}
          onSettings={() => {}}
          onCommand={() => {}}
          onNew={() => {}}
          onExit={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("View subagents")
    expect(frame).toContain("1 recent")
  } finally {
    app.renderer.destroy()
  }
})

test("direct subagent panel renders active subagents", async () => {
  const [tabs] = createSignal([
    subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" }),
    subagent({ sessionID: "s-2", label: "General", description: "Write migration plan", status: "completed" }),
  ])
  const [current] = createSignal<string | undefined>("s-1")
  let rows = 0

  const app = await testRender(
    () => (
      <box width={100} height={RUN_SUBAGENT_PANEL_ROWS}>
        <RunSubagentSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          tabs={tabs}
          current={current}
          onClose={() => {}}
          onSelect={() => {}}
          onRows={(value) => {
            rows = value
          }}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_SUBAGENT_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const list = panelMenu(app.renderer.root)

    expect(frame).toContain("Select subagent")
    expect(frame).toContain("Inspect auth flow")
    expect(frame).toContain("Write migration plan")
    expect(frame).toContain("done")
    expect(frame).not.toContain("┌")
    expect(frame).not.toContain("┃")
    expectPaletteList(list, 0)
    expect(rows).toBe(8)
  } finally {
    app.renderer.destroy()
  }
})

test("direct subagent panel closes when moving up from the first item", async () => {
  const [tabs] = createSignal([
    subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" }),
    subagent({ sessionID: "s-2", label: "General", description: "Write migration plan" }),
  ])
  const [current] = createSignal<string | undefined>()
  let closed = 0

  const app = await testRender(
    () => (
      <box width={100} height={RUN_SUBAGENT_PANEL_ROWS}>
        <RunSubagentSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          tabs={tabs}
          current={current}
          onClose={() => closed++}
          onSelect={() => {}}
        />
      </box>
    ),
    { width: 100, height: RUN_SUBAGENT_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    app.mockInput.pressKey("ARROW_DOWN")
    app.mockInput.pressKey("ARROW_UP")
    expect(closed).toBe(0)

    app.mockInput.pressKey("ARROW_UP")
    expect(closed).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("direct pending panel shows durable delivery without edit actions", async () => {
  const [prompts] = createSignal([
    {
      messageID: "m-1",
      prompt: { text: "fix the auth test", parts: [] },
      delivery: "queue" as const,
      admittedSeq: 1,
    },
  ])

  const app = await testRender(
    () => (
      <box width={100} height={RUN_SUBAGENT_PANEL_ROWS}>
        <RunQueuedPromptSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          prompts={prompts}
          onClose={() => {}}
        />
      </box>
    ),
    { width: 100, height: RUN_SUBAGENT_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const list = panelMenu(app.renderer.root)

    expect(frame).toContain("Pending work")
    expect(frame).toContain("fix the auth test")
    expect(frame).toContain("queue")
    expect(frame).not.toContain("┌")
    expect(frame).not.toContain("┃")
    expectPaletteList(list, 0)
    expect(frame).not.toContain("edit")
    expect(frame).not.toContain("remove")
  } finally {
    app.renderer.destroy()
  }
})

// OpenTUI currently crashes Bun in the full `test/cli/run` directory run here.
// Re-enable after the upstream OpenTUI fix lands in this repo.
test.skip("direct footer recreates the frame across command panel transitions", async () => {
  const app = await renderFooter()

  try {
    await app.renderOnce()

    for (let index = 0; index < 3; index++) {
      const composerFrame = footerComposerFrame(app.renderer.root)
      app.mockInput.pressKey("p", { ctrl: true })
      await app.renderOnce()

      expect(app.captureCharFrame()).toContain("Commands")
      expect(footerComposerFrame(app.renderer.root)).not.toBe(composerFrame)
      app.mockInput.pressKey("c", { ctrl: true })
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Commands")
      expect(app.captureCharFrame()).not.toContain("┃")
      expect(app.captureCharFrame()).not.toContain("█")
    }
  } finally {
    app.cleanup()
  }
})

test.skip("direct footer dispatches leader variant binding only when leader is registered", async () => {
  const calls: string[] = []
  const app = await renderFooter({
    tuiConfig: createTuiResolvedConfig({ keybinds: { leader: "ctrl+x", variant_cycle: "<leader>t" } }),
    onCycle: () => calls.push("cycle"),
  })

  try {
    await app.renderOnce()
    app.mockInput.pressKey("t")
    expect(calls).toEqual([])

    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("t")
    expect(calls).toEqual(["cycle"])
  } finally {
    app.cleanup()
  }
})

test("direct footer keeps leader variant binding inactive when leader is disabled", async () => {
  const calls: string[] = []
  const app = await renderFooter({
    tuiConfig: createTuiResolvedConfig({ keybinds: { leader: "none", variant_cycle: "<leader>t" } }),
    onCycle: () => calls.push("cycle"),
  })

  try {
    await app.renderOnce()
    app.mockInput.pressKey("t")
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("t")

    expect(calls).toEqual([])
  } finally {
    app.cleanup()
  }
})

test("direct footer submits slash autocomplete selections without dispatching shell completions", async () => {
  const submits: RunPrompt[] = []
  const app = await renderFooter({
    commands: [command({ name: "review", description: "Review code" })],
    onSubmit(prompt) {
      submits.push(prompt)
      return true
    },
  })

  try {
    await app.renderOnce()
    "/rev".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    "/rev".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressKey("TAB")
    await app.renderOnce()

    "/re branch".split("").forEach((key) => app.mockInput.pressKey(key))
    Array.from({ length: 7 }).forEach(() => app.mockInput.pressKey("ARROW_LEFT"))
    app.mockInput.pressKey("v")
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    "/nx".split("").forEach((key) => app.mockInput.pressKey(key))
    app.mockInput.pressKey("ARROW_LEFT")
    app.mockInput.pressKey("e")
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    "/n scratch".split("").forEach((key) => app.mockInput.pressKey(key))
    Array.from({ length: 8 }).forEach(() => app.mockInput.pressKey("ARROW_LEFT"))
    app.mockInput.pressKey("e")
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    app.mockInput.pressKey("!")
    "/settings".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([
      { text: "/review ", parts: [], command: { name: "review", arguments: "" } },
      { text: "/review ", parts: [], command: { name: "review", arguments: "" } },
      { text: "/review branch", parts: [], command: { name: "review", arguments: "branch" } },
      { text: "/new ", parts: [] },
      { text: "/new ", parts: [] },
    ])
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("/settings ")
  } finally {
    app.cleanup()
  }
})

test("direct footer slash autocomplete keeps a real skills command", async () => {
  const submits: RunPrompt[] = []
  const app = await renderFooter({
    commands: [
      command({ name: "skills", description: "Run the real skills command" }),
      command({ name: "formatter", description: "Apply formatter fixes", source: "skill" }),
    ],
    onSubmit(prompt) {
      submits.push(prompt)
      return true
    },
  })

  try {
    await app.renderOnce()
    "/skills".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([{ text: "/skills ", parts: [], command: { name: "skills", arguments: "" } }])
    expect(app.captureCharFrame()).not.toContain("Apply formatter fixes")
  } finally {
    app.cleanup()
  }
})

test("direct footer closes settings with ctrl-c instead of arming exit", async () => {
  const app = await renderFooter({ height: 20 })

  try {
    await app.renderOnce()
    "/settings".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Shell")

    app.mockInput.pressKey("c", { ctrl: true })
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Shell")
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("")
  } finally {
    app.cleanup()
  }
})

test("selectedCommand validates the bound command and refreshes its arguments", () => {
  expect(selectedCommand("/opencode-ts", { name: "opencode-ts", arguments: "", source: "skill" })).toEqual({
    name: "opencode-ts",
    arguments: "",
    source: "skill",
  })
  expect(selectedCommand("/deploy prod", { name: "deploy", arguments: "" })).toEqual({
    name: "deploy",
    arguments: "prod",
  })
  expect(selectedCommand("/other", { name: "deploy", arguments: "" })).toBeUndefined()
})

test("direct footer tags skill slash submissions with their catalog source", async () => {
  const submits: RunPrompt[] = []
  const app = await renderFooter({
    commands: [command({ name: "formatter", description: "Apply formatter fixes", source: "skill" })],
    onSubmit(prompt) {
      submits.push(prompt)
      return true
    },
  })

  try {
    await app.renderOnce()
    "/formatter src".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([
      { text: "/formatter src", parts: [], command: { name: "formatter", arguments: "src", source: "skill" } },
    ])
  } finally {
    app.cleanup()
  }
})

// OpenTUI currently segfaults Bun while tearing down this composer-to-skill-panel transition.
// Re-enable after the upstream renderer teardown fix lands.
test.skip("direct footer skill picker inserts an editable bound skill command", async () => {
  const submits: RunPrompt[] = []
  const app = await renderFooter({
    commands: [command({ name: "new", description: "Skill named new", source: "skill" })],
    onSubmit(prompt) {
      submits.push(prompt)
      return true
    },
  })

  try {
    await app.renderOnce()
    "/skills".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("Skill named new")

    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([])
    expect(app.captureCharFrame()).toContain("/new")

    "task".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([
      { text: "/new task", parts: [], command: { name: "new", arguments: "task", source: "skill" } },
    ])
  } finally {
    app.cleanup()
  }
})

// OpenTUI currently segfaults Bun while tearing down this skill-panel close transition.
// Re-enable after the upstream renderer teardown fix lands.
test.skip("direct footer clears the synthetic skills draft when the panel closes", async () => {
  const submits: RunPrompt[] = []
  const app = await renderFooter({
    commands: [command({ name: "formatter", description: "Apply formatter fixes", source: "skill" })],
    onSubmit(prompt) {
      submits.push(prompt)
      return true
    },
  })

  try {
    await app.renderOnce()
    "/skills".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("Apply formatter fixes")

    app.mockInput.pressKey("c", { ctrl: true })
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(submits).toEqual([])
    expect(app.captureCharFrame()).not.toContain("/skills")
  } finally {
    app.cleanup()
  }
})

test("direct footer shows authoritative pending work while running", async () => {
  const [state] = createSignal<FooterState>({
    phase: "running",
    status: "",
    notice: "",
    model: "gpt-5",
    usage: "",
    first: false,
    interrupt: 0,
    exit: 0,
  })
  const [view] = createSignal<FooterView>({ type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>({
    tabs: [subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" })],
    details: {},
    permissions: [],
    forms: [],
  })
  function Harness() {
    return (
      <Keymap.Provider config={tuiConfig}>
        <RunFooterView
          directory={() => "/tmp"}
          findFiles={async () => []}
          agents={() => []}
          references={() => []}
          commands={() => []}
          providers={() => undefined}
          currentAgent={() => "Build"}
          currentAgentID={() => "build"}
          currentModel={() => ({
            providerID: "opencode",
            modelID: "a-model-name-long-enough-to-force-responsive-truncation",
          })}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          queuedPrompts={() => [
            {
              messageID: "m-queued",
              prompt: { text: "follow up", parts: [] },
              delivery: "queue",
              admittedSeq: 1,
            },
          ]}
          theme={() => RUN_THEME_FALLBACK}
          miniSettings={() => ({
            thinking: "hide",
            shell_output: "hide",
            turn_summary: "show",
            footer: "show",
            splash: "show",
            mono: false,
          })}
          mono={false}
          onSubmit={() => true}
          onPermissionReply={() => {}}
          onFormReply={() => {}}
          onFormCancel={() => {}}
          onCycle={() => {}}
          onInterrupt={() => false}
          onEditorOpen={async () => undefined}
          onInputClear={() => {}}
          onExit={() => {}}
          onAgentSelect={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onMiniSettingChange={() => {}}
        />
      </Keymap.Provider>
    )
  }

  const app = await testRender(
    () => (
      <box width={160} height={8}>
        <Harness />
      </box>
    ),
    {
      width: 160,
      height: 8,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const transparent = RGBA.fromValues(0, 0, 0, 0).toInts()
    const tinted = (RUN_THEME_FALLBACK.footer.status as RGBA).toInts()
    const statusline = footerStatusline(app.renderer.root)
    const statusItems = statusline.getChildren().filter((item): item is BoxRenderable => item instanceof BoxRenderable)
    const main = statusItems[0]
    const spinner = main.getChildren()[0]
    const background = statusItems[2]
    const queued = statusItems[3]
    const hint = statusItems.at(-1)!

    expect(spinner).toBeDefined()
    expect(frame).toContain("1 pending")
    expect(frame).toContain("ctrl+b background")
    expect(frame).toContain("ctrl+x q 1 pending")
    expect(frame).toContain("↓ subagents")
    expect(frame).toContain("ctrl+p cmd")
    expect(frame).toContain("subagents · ctrl+p cmd")
    expect(frame).not.toContain("1 agent")
    expect(statusline.backgroundColor.toInts()).toEqual(tinted)
    expect(main.backgroundColor.toInts()).toEqual(transparent)
    expect(background.backgroundColor.toInts()).toEqual(transparent)
    expect(queued.backgroundColor.toInts()).toEqual(transparent)
    expect(hint.backgroundColor.toInts()).toEqual(transparent)
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    app.renderer.destroy()
  }
})

test("direct footer progressively adds model details after the command hint", async () => {
  for (const expected of [
    { width: 24, agent: false, model: false, variant: false },
    { width: 32, agent: false, model: true, variant: false },
    { width: 40, agent: false, model: true, variant: true },
    { width: 80, agent: true, model: true, variant: true },
  ]) {
    const app = await renderFooter({
      providers: [provider()],
      currentAgent: "Plan",
      currentModel: { providerID: "opencode", modelID: "gpt-5" },
      currentVariant: "xhigh",
      width: expected.width,
    })

    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect({
        width: expected.width,
        command: frame.includes("ctrl+p cmd"),
        agent: frame.includes("Plan"),
        model: frame.includes("GPT-5"),
        variant: frame.includes("xhigh"),
      }).toEqual({ ...expected, command: true })
    } finally {
      app.cleanup()
    }
  }
})

test("direct footer always offers backgrounding for a foreground subagent", async () => {
  const app = await renderFooter({
    subagents: {
      tabs: [subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow" })],
      details: {},
      permissions: [],
      forms: [],
    },
    width: 160,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("ctrl+b background · ↓ subagents · ctrl+p cmd")
    expect(frame).not.toContain("queued")
  } finally {
    app.cleanup()
  }
})

test("direct footer hides the subagent hint when only completed subagents remain", async () => {
  const app = await renderFooter({
    subagents: {
      tabs: [subagent({ sessionID: "s-1", label: "Explore", description: "Inspect auth flow", status: "completed" })],
      details: {},
      permissions: [],
      forms: [],
    },
    width: 160,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("ctrl+p cmd")
    expect(frame).not.toContain("↓ subagents")
  } finally {
    app.cleanup()
  }
})

test("direct footer omits interrupt key hint when interrupt is unbound", async () => {
  const app = await renderFooter({
    tuiConfig: createTuiResolvedConfig({ keybinds: { session_interrupt: "none", input_clear: "ctrl+l" } }),
    state: { phase: "running" },
    mono: true,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const statusline = frame.split("\n").find((line) => line.includes("interrupt"))

    expect(frame).toContain("interrupt")
    expect(frame).not.toContain("ctrl+l")
    expect(statusline).toMatch(/^\S/)
  } finally {
    app.cleanup()
  }
})

test("direct footer shows full usage metadata when room is available", async () => {
  const app = await renderFooter({
    state: { usage: "159.6K (16%) · $4.23" },
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("159.6K (16%) · $4.23")
  } finally {
    app.cleanup()
  }
})

test("direct footer hides routine activity and shows explicit notices", async () => {
  let status = ""
  const app = await renderFooter({
    state: { usage: "159.6K (16%) · $4.23" },
    currentAgent: "Plan",
    miniSettings: {
      thinking: "hide",
      shell_output: "hide",
      turn_summary: "show",
      footer: "hide",
      splash: "show",
      mono: true,
    },
    mono: true,
    onStatus: (value) => (status = value),
    width: 160,
  })

  try {
    await app.renderOnce()
    const initial = app.captureCharFrame()
    expect(initial).toContain("ctrl+p cmd")
    expect(initial).not.toContain("Plan")
    expect(initial).not.toContain("gpt-5")
    expect(initial).not.toContain("159.6K")

    app.setState((state) => ({ ...state, phase: "running", status: "assistant responding" }))
    await app.renderOnce()
    const changed = app.captureCharFrame()
    const statusline = footerStatusline(app.renderer.root)

    expect(changed).not.toContain("running")
    expect(changed).not.toContain("assistant responding")
    expect(changed).not.toContain("interrupt")
    expect(changed).not.toContain("gpt-5")
    expect(changed).not.toContain("159.6K")
    expect(boxPath(statusline, "SpinnerRenderable")).toBeUndefined()

    app.mockInput.pressKey("p", { ctrl: true })
    await app.renderOnce()
    await app.mockInput.typeText("status")
    app.mockInput.pressEnter()
    expect(status).toBe("running - agent Plan - gpt-5 - 159.6K (16%) - $4.23")

    app.setState((state) => ({ ...state, notice: "variant high" }))
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("variant high")
  } finally {
    app.cleanup()
  }
})

test("direct footer does not label normal mode as build", async () => {
  const app = await renderFooter()

  try {
    await app.renderOnce()
    const statusline = app
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("cmd"))

    expect(statusline).toBeDefined()
    expect(statusline).not.toContain("BUILD")
  } finally {
    app.cleanup()
  }
})

test("direct permission rejection submits through keymap return binding", async () => {
  let text = ""
  const submits: string[] = []
  function Harness() {
    return (
      <Keymap.Provider config={tuiConfig}>
        <RejectField
          theme={RUN_THEME_FALLBACK.footer}
          text=""
          disabled={false}
          onChange={(input) => {
            text = input
          }}
          onConfirm={() => {
            submits.push(text)
          }}
          onCancel={() => {}}
        />
      </Keymap.Provider>
    )
  }

  const app = await testRender(
    () => (
      <box width={100} height={18}>
        <Harness />
      </box>
    ),
    { width: 100, height: 18, kittyKeyboard: true },
  )

  try {
    await app.renderOnce()
    "retry".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("retry")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(submits).toEqual(["retry"])
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    app.renderer.destroy()
  }
})

test("direct model panel renders current model selector", async () => {
  const [providers] = createSignal<RunProvider[] | undefined>([
    provider(),
    { id: "openai", name: "OpenAI", models: { "gpt-5": model({ id: "gpt-5", name: "GPT-5" }) } },
  ])
  const [current] = createSignal<RunInput["model"]>({ providerID: "opencode", modelID: "gpt-5" })

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunModelSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          providers={providers}
          current={current}
          onClose={() => {}}
          onSelect={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const list = panelMenu(app.renderer.root)

    expect(frame).toContain("Select model")
    expect(frame).toContain("Search")
    expect(frame).toContain("opencode")
    expect(frame).toContain("GPT-5")
    expect(frame).toContain("current")
    expect(frame).toContain("GPT Free")
    expect(frame).toContain("Free")
    expect(frame).not.toContain("┌")
    expect(frame).not.toContain("┃")
    expect(frame).not.toContain("Old Model")
    expectPaletteList(list, 2)

    "gpt-5".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    const search = app.captureCharFrame()

    expect(search.match(/GPT-5/g)).toHaveLength(2)
    expect(search).toContain("opencode")
    expect(search).toContain("OpenAI")
  } finally {
    app.renderer.destroy()
  }
})

test("direct agent panel shows eligible agents and marks the current agent", async () => {
  const [agents] = createSignal<RunAgent[]>([
    { id: "build", name: "Build", description: "Build software", mode: "all", hidden: false },
    { id: "review", name: "Review", description: "Review changes", mode: "primary", hidden: false },
    { id: "explore", name: "Explore", mode: "subagent", hidden: false },
    { id: "secret", name: "Secret", mode: "all", hidden: true },
  ])
  const [current] = createSignal("review")
  let selected: string | undefined

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunAgentSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          agents={agents}
          current={current}
          onClose={() => {}}
          onSelect={(agent) => (selected = agent)}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("Select agent")
    expect(frame).toContain("build")
    expect(frame).toContain("review")
    expect(frame).toContain("Review changes")
    expect(frame).toContain("current")
    expect(frame).not.toContain("explore")
    expect(frame).not.toContain("secret")

    app.mockInput.pressEnter()
    expect(selected).toBe("review")
  } finally {
    app.renderer.destroy()
  }
})

test("direct variant panel renders current variant selector", async () => {
  const [variants] = createSignal(["high", "minimal"])
  const [current] = createSignal<string | undefined>("high")

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunVariantSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          variants={variants}
          current={current}
          onClose={() => {}}
          onSelect={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: RUN_COMMAND_PANEL_ROWS,
    },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    const list = panelMenu(app.renderer.root)

    expect(frame).toContain("Select variant")
    expect(frame).toContain("Default")
    expect(frame).toContain("high")
    expect(frame).toContain("minimal")
    expect(frame).toContain("current")
    expect(frame).not.toContain("┌")
    expect(frame).not.toContain("┃")
    expectPaletteList(list, 1)
  } finally {
    app.renderer.destroy()
  }
})
