/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { RUN_COMMAND_PANEL_ROWS, RunCommandMenuBody, RunModelSelectBody, RunVariantSelectBody } from "@/cli/cmd/run/footer.command"
import { RunEntryContent } from "@/cli/cmd/run/scrollback.writer"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import type { FooterKeybinds, RunCommand, RunInput, RunProvider, StreamCommit } from "@/cli/cmd/run/types"

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

  const app = await testRender(() => (
    <box width={80} height={4}>
      <RunEntryContent commit={commit()} theme={RUN_THEME_FALLBACK} width={80} />
    </box>
  ), {
    width: 80,
    height: 4,
  })

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
  const [variants] = createSignal(["high", "minimal"])

  const app = await testRender(() => (
    <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
      <RunCommandMenuBody
        theme={() => RUN_THEME_FALLBACK.footer}
        commands={commands}
        variants={variants}
        keybinds={keybinds}
        onClose={() => {}}
        onModel={() => {}}
        onVariant={() => {}}
        onVariantCycle={() => {}}
        onCommand={() => {}}
        onNew={() => {}}
        onExit={() => {}}
      />
    </box>
  ), {
    width: 100,
    height: RUN_COMMAND_PANEL_ROWS,
  })

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

test("direct model panel renders current model selector", async () => {
  const [providers] = createSignal<RunProvider[] | undefined>([provider()])
  const [current] = createSignal<RunInput["model"]>({ providerID: "opencode", modelID: "gpt-5" })

  const app = await testRender(() => (
    <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
      <RunModelSelectBody
        theme={() => RUN_THEME_FALLBACK.footer}
        providers={providers}
        current={current}
        onClose={() => {}}
        onSelect={() => {}}
      />
    </box>
  ), {
    width: 100,
    height: RUN_COMMAND_PANEL_ROWS,
  })

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

  const app = await testRender(() => (
    <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
      <RunVariantSelectBody
        theme={() => RUN_THEME_FALLBACK.footer}
        variants={variants}
        current={current}
        onClose={() => {}}
        onSelect={() => {}}
      />
    </box>
  ), {
    width: 100,
    height: RUN_COMMAND_PANEL_ROWS,
  })

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
