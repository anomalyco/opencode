// @ts-nocheck
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { ComposerIsland } from "./composer-island"

const docs = `### Overview
Composer island with a runtime/service API.

Use the same component in Storybook and app code by swapping the \`runtime\` object:
- Storybook: mocked async handlers
- App: SDK-backed handlers

### Runtime API
- \`submit\` / \`abort\`
- \`searchAt\` / \`searchSlash\`
- \`toggleAccept\`
- \`submitQuestion\` / \`rejectQuestion\`
- \`decidePermission\`
`

export default {
  title: "UI/ComposerIsland",
  id: "components-composer-island",
  component: ComposerIsland,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

const questions = [
  {
    text: "Which editor do you use most often?",
    options: [
      { label: "Neovim (Recommended)", description: "Fast keyboard-driven workflow" },
      { label: "VS Code", description: "Feature-rich and extensible" },
      { label: "Zed", description: "Lightweight modern editor" },
    ],
    multiple: false,
  },
  {
    text: "Which testing frameworks should we add?",
    options: [
      { label: "Vitest", description: "Fast unit testing" },
      { label: "Playwright", description: "E2E browser testing" },
      { label: "Testing Library", description: "Component testing" },
    ],
    multiple: true,
  },
]

const at = [
  { type: "file", path: "src/auth.ts", display: "src/auth.ts", recent: true },
  { type: "file", path: "src/middleware.ts", display: "src/middleware.ts" },
  { type: "file", path: "src/routes/login.ts", display: "src/routes/login.ts" },
  { type: "agent", name: "coder", display: "coder" },
  { type: "agent", name: "reviewer", display: "reviewer" },
]

const slash = [
  {
    id: "help",
    trigger: "help",
    title: "Help",
    description: "Show available commands",
    type: "builtin",
    source: "command",
  },
  {
    id: "clear",
    trigger: "clear",
    title: "Clear",
    description: "Clear conversation",
    type: "builtin",
    source: "command",
  },
  {
    id: "review",
    trigger: "review",
    title: "Review",
    description: "Review code changes",
    type: "custom",
    source: "skill",
  },
  {
    id: "test",
    trigger: "test",
    title: "Test",
    description: "Run tests",
    type: "custom",
    source: "mcp",
    keybind: "mod+t",
  },
]

const todos = [
  { content: "Read auth module", status: "completed" as const },
  { content: "Refactor token logic", status: "in_progress" as const },
  { content: "Add tests", status: "pending" as const },
  { content: "Ship changes", status: "pending" as const },
]

const contexts = [
  { id: "c1", path: "src/auth.ts", selection: { startLine: 5, endLine: 10 }, comment: "JWT expiry looks brittle" },
  { id: "c2", path: "src/routes/login.ts", comment: "Rate limit should be stricter" },
]

const dragCycle = [null, "image", "@mention"] as const

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export const Interactive = () => {
  const [mode, setMode] = createSignal<"input" | "question" | "permission">("input")
  const [tab, setTab] = createSignal(0)
  const [showTodos, setShowTodos] = createSignal(true)
  const [todoCollapsed, setTodoCollapsed] = createSignal(false)
  const [showContext, setShowContext] = createSignal(true)
  const [dragIndex, setDragIndex] = createSignal(0)
  const [working, setWorking] = createSignal(false)
  const [accepting, setAccepting] = createSignal(false)
  const [agent, setAgent] = createSignal("ask")
  const [model, setModel] = createSignal("OpenAI/GPT-5.3 Codex")
  const [variant, setVariant] = createSignal("default")
  const [history, setHistory] = createSignal<{ normal: string[]; shell: string[] }>({ normal: [], shell: [] })

  const q = createMemo(() => questions[tab()] ?? questions[0])
  const drag = createMemo(() => dragCycle[dragIndex()] ?? null)

  const runtime = {
    submit: async (input) => {
      setWorking(true)
      await wait(600)
      setWorking(false)
      console.log("submit", input)
    },
    abort: () => {
      setWorking(false)
      console.log("abort")
    },
    toggleAccept: () => {
      setAccepting((value) => !value)
    },
    runSlash: (cmd) => {
      if (cmd.type !== "builtin") return false
      console.log("slash:run", cmd.id)
      return true
    },
    historyRead: (mode) => history()[mode],
    historyWrite: (mode, list) => {
      setHistory((prev) => ({ ...prev, [mode]: list }))
    },
    searchAt: async (filter: string) => {
      await wait(120)
      return at.filter((item) => {
        const value = item.type === "agent" ? item.name : item.path
        return value.toLowerCase().includes(filter.toLowerCase())
      })
    },
    searchSlash: async (filter: string) => {
      await wait(120)
      return slash.filter((item) => item.trigger.toLowerCase().includes(filter.toLowerCase()))
    },
    decidePermission: async (response) => {
      console.log("permission", response)
      await wait(300)
      setMode("input")
    },
    submitQuestion: async (answers) => {
      console.log("question answers", answers)
      await wait(300)
      setMode("input")
      setTab(0)
    },
    rejectQuestion: async () => {
      await wait(150)
      setMode("input")
      setTab(0)
    },
    openContext: (item) => {
      console.log("open context", item)
    },
    removeContext: (item) => {
      console.log("remove context", item)
    },
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return
      if (target instanceof HTMLElement && target.isContentEditable) return

      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

      let hit = false
      if (event.key === "1") {
        setMode("input")
        hit = true
      }
      if (event.key === "2") {
        setMode("question")
        hit = true
      }
      if (event.key === "3") {
        setMode("permission")
        hit = true
      }
      if (event.key === "4") {
        setTodoCollapsed((value) => !value)
        hit = true
      }
      if (event.key === "5") {
        setShowTodos((value) => !value)
        hit = true
      }
      if (event.key === "6") {
        setShowContext((value) => !value)
        hit = true
      }
      if (event.key === "7") {
        setDragIndex((value) => (value + 1) % dragCycle.length)
        hit = true
      }

      if (!hit) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: "20px" }}>
      <div
        style={{
          position: "fixed",
          top: "16px",
          left: "16px",
          display: "flex",
          gap: "8px",
          "font-family": "monospace",
          "font-size": "12px",
          color: "rgba(255, 255, 255, 0.7)",
        }}
      >
        <button onClick={() => setMode("input")}>Ctrl+1 Input</button>
        <button onClick={() => setMode("question")}>Ctrl+2 Question</button>
        <button onClick={() => setMode("permission")}>Ctrl+3 Permission</button>
        <button onClick={() => setTodoCollapsed((value) => !value)}>Ctrl+4 Collapse</button>
        <button onClick={() => setShowTodos((value) => !value)}>Ctrl+5 Todos</button>
        <button onClick={() => setShowContext((value) => !value)}>Ctrl+6 Context</button>
        <button onClick={() => setDragIndex((value) => (value + 1) % dragCycle.length)}>Ctrl+7 Drag</button>
      </div>

      <ComposerIsland
        mode={mode()}
        runtime={runtime}
        agentOptions={["ask", "coder", "reviewer"]}
        modelOptions={[
          "OpenAI/GPT-5.2",
          "OpenAI/GPT-5.3 Codex",
          "OpenAI/GPT-5.3 Codex Spark",
          "Anthropic/Claude Sonnet 4",
          "Anthropic/Claude Haiku 4.5",
          "Google/Gemini 2.5 Pro",
        ]}
        variantOptions={["default", "fast", "quality"]}
        agentCurrent={agent()}
        modelCurrent={model()}
        variantCurrent={variant()}
        onAgentSelect={setAgent}
        onModelSelect={setModel}
        onVariantSelect={setVariant}
        agentKeybind="mod+."
        modelKeybind="mod+'"
        variantKeybind="shift+mod+d"
        working={working()}
        accepting={accepting()}
        placeholder="Ask anything..."
        questionText={q().text}
        questionOptions={q().options}
        questionMultiple={q().multiple}
        questionIndex={tab()}
        questionTotal={questions.length}
        onQuestionBack={() => setTab((value) => Math.max(0, value - 1))}
        onQuestionNext={() => setTab((value) => Math.min(questions.length - 1, value + 1))}
        onQuestionJump={setTab}
        onQuestionDismiss={() => {
          setMode("input")
          setTab(0)
        }}
        agentName="Ask"
        modelName="GPT-4"
        variant="default"
        todos={todos}
        showTodos={showTodos()}
        todoCollapsed={todoCollapsed()}
        onTodoCollapseChange={setTodoCollapsed}
        contextItems={showContext() ? contexts : []}
        forceDragType={drag()}
        permissionDescription="Modify files, including edits, writes, patches, and multi-edits"
        permissionPatterns={["src/**/*.ts", "tests/**/*.ts"]}
      />
    </div>
  )
}
