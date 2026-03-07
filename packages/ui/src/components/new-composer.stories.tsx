// @ts-nocheck
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { NewComposer } from "./new-composer"

const docs = `### Overview
Runtime-ready composer story with visible canvas controls + Storybook controls.

### Canvas controls
- Input / Question / Permission mode
- Todos, collapse, context, drag overlay
- Keyboard: Ctrl+1..7 toggles, Ctrl+8/9 answer count (Q1), Ctrl+[/] answer count (Q2), Ctrl+;/' answer count (Q3), Ctrl+0/- todo count

### Storybook controls
- mode
- working
- accepting
- showTodos
- todoCollapsed
- forceDragType
- answerCount1
- answerCount2
- answerCount3
- todoCount
`

export default {
  title: "UI/NewComposer",
  id: "components-new-composer",
  component: NewComposer,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    mode: {
      control: "select",
      options: ["input", "question", "permission"],
    },
    working: {
      control: "boolean",
    },
    accepting: {
      control: "boolean",
    },
    showTodos: {
      control: "boolean",
    },
    todoCollapsed: {
      control: "boolean",
    },
    forceDragType: {
      control: "select",
      options: [null, "image", "@mention"],
    },
    answerCount1: {
      control: { type: "range", min: 1, max: 6, step: 1 },
    },
    answerCount2: {
      control: { type: "range", min: 1, max: 6, step: 1 },
    },
    answerCount3: {
      control: { type: "range", min: 1, max: 6, step: 1 },
    },
    todoCount: {
      control: { type: "range", min: 0, max: 8, step: 1 },
    },
  },
}

const questions = [
  {
    text: "Which editor do you use most often?",
    options: [
      { label: "Neovim", description: "Fast keyboard-driven workflow" },
      { label: "VS Code", description: "Feature-rich and extensible" },
      { label: "Zed", description: "Lightweight modern editor" },
      { label: "JetBrains IDE", description: "Deep language tooling" },
      { label: "Sublime Text", description: "Fast, lightweight setup" },
      { label: "Helix", description: "Modal editor with tree-sitter" },
    ],
    multiple: false,
  },
  {
    text: "Which testing frameworks should we add?",
    options: [
      { label: "Vitest", description: "Fast unit testing" },
      { label: "Playwright", description: "E2E browser testing" },
      { label: "Testing Library", description: "Component testing" },
      { label: "Cypress", description: "Browser integration tests" },
      { label: "Jest", description: "Legacy compatibility" },
      { label: "Storybook Tests", description: "Interaction smoke tests" },
    ],
    multiple: true,
  },
  {
    text: "How strict should linting be?",
    options: [
      { label: "Minimal", description: "Keep only important rules" },
      { label: "Balanced", description: "Recommended defaults" },
      { label: "Strict", description: "Catch everything possible" },
      { label: "Very strict", description: "Treat warnings as errors" },
      { label: "Preset by package", description: "Different rules per surface" },
      { label: "Experimental", description: "Try strict mode for one sprint" },
    ],
    multiple: false,
  },
]

const todos = [
  { content: "Read auth module", status: "completed" },
  { content: "Refactor token logic", status: "in_progress" },
  { content: "Add tests", status: "pending" },
  { content: "Ship changes", status: "pending" },
  { content: "Check telemetry events", status: "pending" },
  { content: "Validate markdown rendering", status: "pending" },
  { content: "Run regression suite", status: "pending" },
  { content: "Update release notes", status: "pending" },
]

const ctx = [
  { id: "a", path: "src/auth.ts", selection: { startLine: 5, endLine: 10 }, comment: "Check token refresh" },
  { id: "b", path: "src/routes/login.ts", comment: "Review edge cases" },
]

const dragModes = [null, "image", "@mention"] as const

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const panel = {
  position: "fixed",
  top: "14px",
  left: "14px",
  display: "flex",
  "flex-wrap": "wrap",
  gap: "8px",
  padding: "8px",
  "border-radius": "10px",
  background: "rgba(0, 0, 0, 0.55)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  color: "#fff",
  "font-family": "monospace",
  "font-size": "11px",
  "z-index": 50,
} as const

const btn = (on: boolean) =>
  ({
    padding: "4px 8px",
    "border-radius": "8px",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    background: on ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.07)",
    color: "#fff",
    cursor: "pointer",
  }) as const

export const Interactive = {
  args: {
    mode: "input",
    working: false,
    accepting: false,
    showTodos: true,
    todoCollapsed: false,
    forceDragType: null,
    answerCount1: 4,
    answerCount2: 3,
    answerCount3: 5,
    todoCount: 4,
  },
  render: (args) => {
    const limit = (value: number, i: number) => Math.max(1, Math.min(questions[i].options.length, value))

    const [mode, setMode] = createSignal(args.mode ?? "input")
    const [tab, setTab] = createSignal(0)
    const [work, setWork] = createSignal(!!args.working)
    const [accept, setAccept] = createSignal(!!args.accepting)
    const [showTodos, setShowTodos] = createSignal(args.showTodos ?? true)
    const [todoCollapsed, setTodoCollapsed] = createSignal(args.todoCollapsed ?? false)
    const [drag, setDrag] = createSignal(args.forceDragType ?? null)
    const [a1, setA1] = createSignal(limit(args.answerCount1 ?? 4, 0))
    const [a2, setA2] = createSignal(limit(args.answerCount2 ?? 3, 1))
    const [a3, setA3] = createSignal(limit(args.answerCount3 ?? 5, 2))
    const [tCount, setTCount] = createSignal(Math.max(0, Math.min(todos.length, args.todoCount ?? 4)))
    const [showCtx, setShowCtx] = createSignal(true)
    const [agent, setAgent] = createSignal("ask")
    const [model, setModel] = createSignal("OpenAI/GPT-5.3 Codex")
    const [variant, setVariant] = createSignal("default")
    const [history, setHistory] = createSignal<{ normal: string[]; shell: string[] }>({ normal: [], shell: [] })

    createEffect(() => setMode(args.mode ?? "input"))
    createEffect(() => setWork(!!args.working))
    createEffect(() => setAccept(!!args.accepting))
    createEffect(() => setShowTodos(args.showTodos ?? true))
    createEffect(() => setTodoCollapsed(args.todoCollapsed ?? false))
    createEffect(() => setDrag(args.forceDragType ?? null))
    createEffect(() => setA1(limit(args.answerCount1 ?? 4, 0)))
    createEffect(() => setA2(limit(args.answerCount2 ?? 3, 1)))
    createEffect(() => setA3(limit(args.answerCount3 ?? 5, 2)))
    createEffect(() => setTCount(Math.max(0, Math.min(todos.length, args.todoCount ?? 4))))

    const qList = createMemo(() => [
      { ...questions[0], options: questions[0].options.slice(0, a1()) },
      { ...questions[1], options: questions[1].options.slice(0, a2()) },
      { ...questions[2], options: questions[2].options.slice(0, a3()) },
    ])
    const tList = createMemo(() => todos.slice(0, tCount()))

    createEffect(() => {
      if (tab() <= qList().length - 1) return
      setTab(qList().length - 1)
    })

    const q = createMemo(() => qList()[tab()] ?? qList()[0])

    const runtime = {
      submit: async (input) => {
        setWork(true)
        await wait(550)
        setWork(false)
        console.log("submit", input)
      },
      abort: () => {
        setWork(false)
      },
      toggleAccept: () => setAccept((v) => !v),
      runSlash: (cmd) => {
        if (cmd.type !== "builtin") return false
        console.log("slash:run", cmd.id)
        return true
      },
      historyRead: (mode) => history()[mode],
      historyWrite: (mode, list) => {
        setHistory((prev) => ({ ...prev, [mode]: list }))
      },
      decidePermission: async (response) => {
        console.log("permission", response)
        await wait(200)
        setMode("input")
      },
      submitQuestion: async (answers) => {
        console.log("question", answers)
        await wait(250)
        setMode("input")
        setTab(0)
      },
      rejectQuestion: async () => {
        await wait(150)
        setMode("input")
        setTab(0)
      },
      openContext: (item) => console.log("open context", item),
      removeContext: (item) => console.log("remove context", item),
    }

    const cycle = () => {
      const i = dragModes.findIndex((v) => v === drag())
      const n = (i + 1) % dragModes.length
      setDrag(dragModes[n])
    }

    onMount(() => {
      const onKey = (event: KeyboardEvent) => {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
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
          setTodoCollapsed((v) => !v)
          hit = true
        }
        if (event.key === "5") {
          setShowTodos((v) => !v)
          hit = true
        }
        if (event.key === "6") {
          setShowCtx((v) => !v)
          hit = true
        }
        if (event.key === "7") {
          cycle()
          hit = true
        }
        if (event.key === "8") {
          setA1((v) => limit(v - 1, 0))
          hit = true
        }
        if (event.key === "9") {
          setA1((v) => limit(v + 1, 0))
          hit = true
        }
        if (event.key === "[") {
          setA2((v) => limit(v - 1, 1))
          hit = true
        }
        if (event.key === "]") {
          setA2((v) => limit(v + 1, 1))
          hit = true
        }
        if (event.key === ";") {
          setA3((v) => limit(v - 1, 2))
          hit = true
        }
        if (event.key === "'") {
          setA3((v) => limit(v + 1, 2))
          hit = true
        }
        if (event.key === "0") {
          setTCount((v) => Math.max(0, v - 1))
          hit = true
        }
        if (event.key === "-") {
          setTCount((v) => Math.min(todos.length, v + 1))
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
        <div style={panel}>
          <button style={btn(mode() === "input")} onClick={() => setMode("input")}>
            Ctrl+1 Input
          </button>
          <button style={btn(mode() === "question")} onClick={() => setMode("question")}>
            Ctrl+2 Question
          </button>
          <button style={btn(mode() === "permission")} onClick={() => setMode("permission")}>
            Ctrl+3 Permission
          </button>
          <button style={btn(showTodos())} onClick={() => setShowTodos((v) => !v)}>
            Ctrl+5 Todos
          </button>
          <button style={btn(todoCollapsed())} onClick={() => setTodoCollapsed((v) => !v)}>
            Ctrl+4 Collapse
          </button>
          <button style={btn(showCtx())} onClick={() => setShowCtx((v) => !v)}>
            Ctrl+6 Context
          </button>
          <button style={btn(!!drag())} onClick={cycle}>
            Ctrl+7 Drag: {drag() ?? "off"}
          </button>
          <button style={btn(work())} onClick={() => setWork((v) => !v)}>
            Working
          </button>
          <button style={btn(accept())} onClick={() => setAccept((v) => !v)}>
            Auto-accept
          </button>
          <button style={btn(false)} onClick={() => setA1((v) => limit(v - 1, 0))}>
            Ctrl+8 Q1-
          </button>
          <span>Q1:{a1()}</span>
          <button style={btn(false)} onClick={() => setA1((v) => limit(v + 1, 0))}>
            Ctrl+9 Q1+
          </button>
          <button style={btn(false)} onClick={() => setA2((v) => limit(v - 1, 1))}>
            Ctrl+[ Q2-
          </button>
          <span>Q2:{a2()}</span>
          <button style={btn(false)} onClick={() => setA2((v) => limit(v + 1, 1))}>
            Ctrl+] Q2+
          </button>
          <button style={btn(false)} onClick={() => setA3((v) => limit(v - 1, 2))}>
            Ctrl+; Q3-
          </button>
          <span>Q3:{a3()}</span>
          <button style={btn(false)} onClick={() => setA3((v) => limit(v + 1, 2))}>
            Ctrl+' Q3+
          </button>
          <button style={btn(false)} onClick={() => setTCount((v) => Math.max(0, v - 1))}>
            Ctrl+0 T-
          </button>
          <span>T:{tCount()}</span>
          <button style={btn(false)} onClick={() => setTCount((v) => Math.min(todos.length, v + 1))}>
            Ctrl+- T+
          </button>
        </div>

        <NewComposer
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
          working={work()}
          accepting={accept()}
          questionText={q()?.text ?? "Which editor do you use most often?"}
          questionOptions={q()?.options ?? []}
          questionMultiple={q()?.multiple ?? false}
          questionIndex={tab()}
          questionTotal={qList().length}
          onQuestionBack={() => setTab((v) => Math.max(0, v - 1))}
          onQuestionNext={() => setTab((v) => Math.min(qList().length - 1, v + 1))}
          onQuestionJump={setTab}
          onQuestionDismiss={() => {
            setMode("input")
            setTab(0)
          }}
          showTodos={showTodos()}
          todoCollapsed={todoCollapsed()}
          onTodoCollapseChange={setTodoCollapsed}
          todos={tList()}
          contextItems={showCtx() ? ctx : []}
          forceDragType={drag()}
          permissionDescription="This action needs write access to project files."
          permissionPatterns={["src/**/*.ts", "tests/**/*.ts"]}
        />
      </div>
    )
  },
}
