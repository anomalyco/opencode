/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import {
  RUN_COMMAND_PANEL_ROWS,
  RUN_SUBAGENT_PANEL_ROWS,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "@/cli/cmd/run/footer.command"
import { RunFooterView } from "@/cli/cmd/run/footer.view"
import { RunEntryContent } from "@/cli/cmd/run/scrollback.writer"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import type {
  FooterKeybinds,
  FooterState,
  FooterSubagentState,
  FooterSubagentTab,
  FooterView,
  RunCommand,
  RunInput,
  RunProvider,
  StreamCommit,
} from "@/cli/cmd/run/types"
import { RunQuestionBody } from "@/cli/cmd/run/footer.question"

function bindings(...keys: string[]) {
  return keys.map((key) => ({ key }))
}

const keybinds: FooterKeybinds = {
  leader: "ctrl+x",
  leaderTimeout: 2000,
  commandList: bindings("ctrl+p"),
  variantCycle: bindings("ctrl+t"),
  interrupt: bindings("escape"),
  historyPrevious: bindings("up"),
  historyNext: bindings("down"),
  inputClear: bindings("ctrl+c"),
  inputSubmit: bindings("return"),
  inputNewline: bindings("shift+return,ctrl+return,alt+return,ctrl+j"),
}

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
          variants={variants}
          keybinds={keybinds}
          onClose={() => {}}
          onModel={() => {}}
          onSubagent={() => {}}
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
          variants={variants}
          keybinds={keybinds}
          onClose={() => {}}
          onModel={() => {}}
          onSubagent={() => {}}
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

test("direct footer shows subagent indicator while prompt is running", async () => {
  const [state] = createSignal<FooterState>({
    phase: "running",
    status: "",
    queue: 0,
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

  const app = await testRender(
    () => (
      <box width={100} height={8}>
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
          theme={RUN_THEME_FALLBACK}
          keybinds={keybinds}
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
        />
      </box>
    ),
    {
      width: 100,
      height: 8,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("interrupt · 1 agent · ↓ to view")
  } finally {
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
