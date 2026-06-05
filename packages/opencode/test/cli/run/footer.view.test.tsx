/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA, type BoxRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@/cli/cmd/tui/keymap"
import {
  RUN_COMMAND_PANEL_ROWS,
  RUN_SUBAGENT_PANEL_ROWS,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "@/cli/cmd/run/footer.command"
import { RunFooterView } from "@/cli/cmd/run/footer.view"
import { RunEntryContent } from "@/cli/cmd/run/scrollback.writer"
import { RUN_THEME_FALLBACK, type RunTheme } from "@/cli/cmd/run/theme"
import type {
  FooterState,
  FooterSubagentState,
  FooterSubagentTab,
  FooterView,
  RunCommand,
  RunInput,
  RunPrompt,
  RunProvider,
  RunTuiConfig,
  StreamCommit,
} from "@/cli/cmd/run/types"
import { RunQuestionBody } from "@/cli/cmd/run/footer.question"
import { RejectField } from "@/cli/cmd/run/footer.permission"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const tuiConfig = createTuiResolvedConfig()

function command(input: { name: string; description: string; source?: "command" | "mcp" | "skill" }) {
  return {
    name: input.name,
    description: input.description,
    source: input.source,
    template: "",
    hints: [],
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
    id: input.id,
    providerID: "opencode",
    api: {
      id: "opencode",
      url: "https://opencode.ai",
      npm: "@ai-sdk/openai-compatible",
    },
    name: input.name,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: true,
        video: false,
        pdf: true,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: input.cost ?? 1,
      output: 1,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    status: input.status ?? "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: input.variants,
  } satisfies RunProvider["models"][string]
}

function provider() {
  return {
    id: "opencode",
    name: "opencode",
    source: "api",
    env: [],
    options: {},
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
    partID: `part-${input.sessionID}`,
    callID: `call-${input.sessionID}`,
    label: input.label,
    description: input.description,
    status: input.status ?? "running",
    lastUpdatedAt: 1,
  } satisfies FooterSubagentTab
}

function footerState(input: Partial<FooterState> = {}) {
  return createSignal<FooterState>({
    phase: "idle",
    status: "",
    queue: 0,
    model: "gpt-5",
    duration: "",
    usage: "",
    first: false,
    interrupt: 0,
    exit: 0,
    ...input,
  })[0]
}

async function renderFooter(
  input: {
    tuiConfig?: RunTuiConfig
    commands?: RunCommand[]
    theme?: () => RunTheme
    onCycle?: () => void
    onSubmit?: (prompt: RunPrompt) => boolean
  } = {},
) {
  const [view] = createSignal<FooterView>({ type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>({ tabs: [], details: {}, permissions: [], questions: [] })
  const state = footerState()
  const config = input.tuiConfig ?? tuiConfig
  let offKeymap: (() => void) | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    offKeymap = registerOpencodeKeymap(keymap, renderer, config)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <RunFooterView
          directory="/tmp"
          findFiles={async () => []}
          agents={() => []}
          resources={() => []}
          commands={() => input.commands ?? []}
          providers={() => undefined}
          currentModel={() => undefined}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          theme={input.theme ?? (() => RUN_THEME_FALLBACK)}
          tuiConfig={config}
          backgroundSubagents={true}
          agent="opencode"
          onSubmit={input.onSubmit ?? (() => true)}
          onPermissionReply={() => {}}
          onQuestionReply={() => {}}
          onQuestionReject={() => {}}
          onCycle={input.onCycle ?? (() => {})}
          onInterrupt={() => false}
          onInputClear={() => {}}
          onExit={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onQueuedRemove={async () => true}
        />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(
    () => (
      <box width={100} height={8}>
        <Harness />
      </box>
    ),
    { width: 100, height: 8, kittyKeyboard: true },
  )

  return {
    ...app,
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      offKeymap?.()
      offKeymap = undefined
      app.renderer.destroy()
    },
  }
}

test("direct footer updates composer background when theme changes", async () => {
  const surface = RGBA.fromHex("#123456")
  const [theme, setTheme] = createSignal(RUN_THEME_FALLBACK)
  const app = await renderFooter({ theme })

  try {
    await app.renderOnce()
    const area = app.renderer.root.findDescendantById("run-direct-footer-composer-area") as BoxRenderable

    expect(area.backgroundColor.toInts()).not.toEqual(surface.toInts())
    setTheme({
      ...RUN_THEME_FALLBACK,
      footer: {
        ...RUN_THEME_FALLBACK.footer,
        surface,
      },
    })
    await app.renderOnce()

    expect(area.backgroundColor.toInts()).toEqual(surface.toInts())
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
    tool: "bash",
  })

  const app = await testRender(
    () => (
      <box width={80} height={4}>
        <RunEntryContent commit={commit()} theme={RUN_THEME_FALLBACK} width={80} />
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
      tool: "bash",
    })
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("I need to inspect the codebase")
  } finally {
    app.renderer.destroy()
  }
})

test("direct command panel renders grouped command palette", async () => {
  const [commands] = createSignal<RunCommand[] | undefined>([
    command({ name: "review", description: "Review code" }),
    command({ name: "deploy", description: "Deploy prompt", source: "mcp" }),
    command({ name: "internal", description: "Skill command", source: "skill" }),
  ])
  const [subagents] = createSignal([])
  const [variants] = createSignal(["high", "minimal"])

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
          onModel={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
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
    expect(frame).toContain("Search")
    expect(frame).toContain("Suggested")
    expect(frame).toContain("Switch model")
    expect(frame).toContain("Variant cycle")
    expect(frame).toContain("ctrl+t")
    expect(frame).toContain("Switch model variant")
    expect(frame).toContain("Session")
    expect(frame).toContain("New session")
    expect(frame).toContain("/new")
    expect(frame).toContain("Project Commands")
    expect(frame).toContain("review")
    expect(frame).toContain("/review")
    expect(frame).not.toContain("/internal")
    expect(frame).not.toContain("Choose model for future turns")
    expect(frame).not.toContain("Cycle reasoning effort for future turns")
    expect(frame).not.toContain("Review code")
    expect(frame).not.toContain("Commands 8")
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
          onModel={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
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

    expect(frame).toContain("Select subagent")
    expect(frame).toContain("Inspect auth flow")
    expect(frame).toContain("Write migration plan")
    expect(frame).toContain("done")
    expect(rows).toBe(8)
  } finally {
    app.renderer.destroy()
  }
})

test("direct queued prompt panel renders pending prompt actions", async () => {
  const [prompts] = createSignal([
    { messageID: "m-1", partID: "p-1", prompt: { text: "fix the auth test", parts: [] } },
  ])

  const app = await testRender(
    () => (
      <box width={100} height={RUN_SUBAGENT_PANEL_ROWS}>
        <RunQueuedPromptSelectBody
          theme={() => RUN_THEME_FALLBACK.footer}
          prompts={prompts}
          onClose={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </box>
    ),
    { width: 100, height: RUN_SUBAGENT_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Queued prompts")
    expect(app.captureCharFrame()).toContain("fix the auth test")
    expect(app.captureCharFrame()).toContain("queued")
  } finally {
    app.renderer.destroy()
  }
})

// OpenTUI currently segfaults when the full footer view suite creates several
// keymap-backed test renderers in one process. Re-enable after the runtime fix.
test.skip("direct footer opens command panel through keymap binding", async () => {
  const app = await renderFooter()

  try {
    await app.renderOnce()
    app.mockInput.pressKey("p", { ctrl: true })
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("Commands")
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
    "/rev".split("").forEach((key) => app.mockInput.pressKey(key))
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
    expect(app.captureCharFrame()).toContain("/review")
  } finally {
    app.cleanup()
  }
})

test("direct footer shows editable prompts and additional queued work while running", async () => {
  const [state] = createSignal<FooterState>({
    phase: "running",
    status: "",
    queue: 3,
    model: "gpt-5",
    duration: "",
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
    questions: [],
  })
  let offKeymap: (() => void) | undefined
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    offKeymap = registerOpencodeKeymap(keymap, renderer, tuiConfig)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <RunFooterView
          directory="/tmp"
          findFiles={async () => []}
          agents={() => []}
          resources={() => []}
          commands={() => []}
          providers={() => undefined}
          currentModel={() => undefined}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          queuedPrompts={() => [
            { messageID: "m-queued", partID: "p-queued", prompt: { text: "follow up", parts: [] } },
          ]}
          theme={() => RUN_THEME_FALLBACK}
          tuiConfig={tuiConfig}
          backgroundSubagents={true}
          agent="opencode"
          onSubmit={() => true}
          onPermissionReply={() => {}}
          onQuestionReply={() => {}}
          onQuestionReject={() => {}}
          onCycle={() => {}}
          onInterrupt={() => false}
          onInputClear={() => {}}
          onExit={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onQueuedRemove={async () => true}
        />
      </OpencodeKeymapProvider>
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
    expect(app.captureCharFrame()).toContain("interrupt • 1 agent ctrl+x down • ctrl+b background • 1 queued ctrl+x q")
    expect(app.captureCharFrame()).toContain("2 queued")
    expect(app.captureCharFrame()).not.toContain("to view")
    expect(app.captureCharFrame()).not.toContain("edit/remove")
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    offKeymap?.()
    app.renderer.destroy()
  }
})

test("direct question body separates single-select checkmark from label", async () => {
  const request = {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Which categorical concept is often described as a universal way to combine two objects?",
        header: "Universal Product",
        options: [
          { label: "Product", description: "A product comes with projections." },
          { label: "Equalizer", description: "An equalizer selects morphisms where arrows agree." },
        ],
      },
    ],
  } satisfies QuestionRequest
  const replies: unknown[] = []

  const app = await testRender(
    () => (
      <box width={100} height={12}>
        <RunQuestionBody
          request={request}
          theme={RUN_THEME_FALLBACK.footer}
          onReply={(input) => {
            replies.push(input)
          }}
          onReject={() => {}}
        />
      </box>
    ),
    {
      width: 100,
      height: 12,
    },
  )

  try {
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(replies).toHaveLength(1)
    expect(app.captureCharFrame()).toContain("Product ✓")
  } finally {
    app.renderer.destroy()
  }
})

// OpenTUI currently segfaults while tearing down this textarea-backed keymap renderer.
// Re-enable after the runtime fix.
test.skip("direct custom answer submits through keymap return binding", async () => {
  const question = {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Which answer should I use?",
        header: "Answer",
        options: [{ label: "Provided", description: "Use the listed answer." }],
        custom: true,
      },
    ],
  } satisfies QuestionRequest
  const questions: unknown[] = []
  let off: (() => void) | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    off = registerOpencodeKeymap(keymap, renderer, tuiConfig)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <RunQuestionBody
          request={question}
          theme={RUN_THEME_FALLBACK.footer}
          onReply={(input) => {
            questions.push(input)
          }}
          onReject={() => {}}
        />
      </OpencodeKeymapProvider>
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
    app.mockInput.pressKey("2")
    await app.renderOnce()
    "typed".split("").forEach((key) => app.mockInput.pressKey(key))
    await app.renderOnce()
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(questions).toEqual([{ requestID: "question-1", answers: [["typed"]] }])
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    off?.()
    app.renderer.destroy()
  }
})

test("direct permission rejection submits through keymap return binding", async () => {
  let text = ""
  const submits: string[] = []
  let off: (() => void) | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    off = registerOpencodeKeymap(keymap, renderer, tuiConfig)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
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
      </OpencodeKeymapProvider>
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
    off?.()
    app.renderer.destroy()
  }
})

test("direct model panel renders current model selector", async () => {
  const [providers] = createSignal<RunProvider[] | undefined>([provider()])
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

    expect(frame).toContain("Select model")
    expect(frame).toContain("Search")
    expect(frame).toContain("opencode")
    expect(frame).toContain("GPT-5")
    expect(frame).toContain("current")
    expect(frame).toContain("GPT Free")
    expect(frame).toContain("Free")
    expect(frame).not.toContain("Old Model")
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

    expect(frame).toContain("Select variant")
    expect(frame).toContain("Default")
    expect(frame).toContain("high")
    expect(frame).toContain("minimal")
    expect(frame).toContain("current")
  } finally {
    app.renderer.destroy()
  }
})
