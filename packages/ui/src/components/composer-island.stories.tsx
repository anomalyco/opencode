// @ts-nocheck
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { ComposerIsland } from "./composer-island"

const docs = `### Overview
Dynamic island style composer that blends question UI with chat input.

Designed to seamlessly morph between chat input and question-asking modes.

### Interactive Demo
This story provides an interactive demo where you can toggle between input and question modes:
- Press **1** to toggle question mode
- Press **2** to toggle todos
- Press **3** to toggle todo collapse
- Or click the toggles at the top

The transition uses smooth spring animation for a polished feel.

### API
- \`mode\`: "input" | "question" - Controls the display mode
- \`questionText\`: The question to display in question mode
- \`questionOptions\`: Array of options with label and optional description
- \`questionMultiple\`: Whether multiple options can be selected
- \`placeholder\`: Placeholder text for input mode
- \`agentName\`: Name of the agent (shows in footer)
- \`modelName\`: Name of the model (shows in footer)
- \`variant\`: Variant name (shows in footer)

### Variants and states
- Input mode: Chat composer with text area
- Question mode: Question with selectable options

### Behavior
- Click options to select in question mode
- Type directly in input mode
- Footer adapts to show appropriate controls

### Accessibility
- Clear visual distinction between modes
- Keyboard navigation support for options

### Theming/tokens
- Uses rounded container with border
- Adapts to theme colors
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

export const Interactive = () => {
  const [mode, setMode] = createSignal<"input" | "question">("input")
  const [showHint, setShowHint] = createSignal(true)
  const [showTodos, setShowTodos] = createSignal(false)
  const [todoCollapsed, setTodoCollapsed] = createSignal(false)

  // Spring tuning
  const [heightDuration, setHeightDuration] = createSignal(0.35)
  const [heightBounce, setHeightBounce] = createSignal(0.2)
  const [morphDuration, setMorphDuration] = createSignal(0.25)
  const [morphBounce, setMorphBounce] = createSignal(0.1)

  const toggleMode = () => {
    setMode((m) => (m === "input" ? "question" : "input"))
    setShowHint(false)
  }

  const allTodos = [
    { content: "Read the authentication module", status: "completed" as const },
    { content: "Identify security vulnerabilities", status: "completed" as const },
    { content: "Refactor token validation logic", status: "in_progress" as const },
    { content: "Add rate limiting middleware", status: "pending" as const },
    { content: "Write integration tests", status: "pending" as const },
    { content: "Update API documentation", status: "pending" as const },
    { content: "Set up CI pipeline", status: "pending" as const },
    { content: "Review pull request comments", status: "pending" as const },
    { content: "Deploy to staging environment", status: "pending" as const },
    { content: "Run load tests", status: "pending" as const },
  ]
  const [todoCount, setTodoCount] = createSignal(5)
  const visibleTodos = () => allTodos.slice(0, todoCount())

  // Keyboard shortcuts: 1=question, 2=todos, 3=collapse
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.repeat) return

      if (e.key === "1") {
        e.preventDefault()
        e.stopPropagation()
        toggleMode()
      } else if (e.key === "2") {
        e.preventDefault()
        e.stopPropagation()
        setShowTodos((v) => !v)
      } else if (e.key === "3") {
        e.preventDefault()
        e.stopPropagation()
        setTodoCollapsed((v) => !v)
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        e.stopPropagation()
        setTodoCount((c) => Math.min(c + 1, allTodos.length))
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        e.stopPropagation()
        setTodoCount((c) => Math.max(c - 1, 1))
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown))
  })

  const questionOptions = [
    { label: "src/auth.ts", description: "Main authentication module" },
    { label: "src/middleware.ts", description: "Request middleware" },
    { label: "src/routes/login.ts", description: "Login route handler" },
  ]

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        padding: "20px",
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
      }}
    >
      {/* Mode indicator and toggle */}
      <div
        style={{
          position: "fixed",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          gap: "12px",
          "z-index": 100,
        }}
      >
        {/* Question toggle (1) */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "12px",
            padding: "8px 16px",
            "border-radius": "20px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <span
            style={{
              "font-size": "14px",
              color: mode() === "input" ? "#fff" : "rgba(255, 255, 255, 0.5)",
              "font-weight": mode() === "input" ? 500 : 400,
              transition: "all 0.2s ease",
            }}
          >
            Input
          </span>
          <div
            style={{
              width: "36px",
              height: "20px",
              "border-radius": "10px",
              background: "rgba(255, 255, 255, 0.1)",
              position: "relative",
              cursor: "pointer",
            }}
            onClick={toggleMode}
          >
            <div
              style={{
                width: "16px",
                height: "16px",
                "border-radius": "50%",
                background: "#fff",
                position: "absolute",
                top: "2px",
                left: mode() === "input" ? "2px" : "18px",
                transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>
          <span
            style={{
              "font-size": "14px",
              color: mode() === "question" ? "#fff" : "rgba(255, 255, 255, 0.5)",
              "font-weight": mode() === "question" ? 500 : 400,
              transition: "all 0.2s ease",
            }}
          >
            Question
          </span>
          <span style={{ "font-size": "11px", color: "rgba(255, 255, 255, 0.3)", "font-family": "monospace" }}>1</span>
        </div>

        {/* Todos toggle (2) */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "6px 14px",
            "border-radius": "16px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            cursor: "pointer",
          }}
          onClick={() => setShowTodos((v) => !v)}
        >
          <div
            style={{
              width: "28px",
              height: "16px",
              "border-radius": "8px",
              background: showTodos() ? "var(--icon-interactive-base)" : "rgba(255, 255, 255, 0.1)",
              position: "relative",
              transition: "background 0.2s ease",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                "border-radius": "50%",
                background: "#fff",
                position: "absolute",
                top: "2px",
                left: showTodos() ? "14px" : "2px",
                transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>
          <span style={{ "font-size": "13px", color: "rgba(255, 255, 255, 0.7)" }}>Todos</span>
          <span style={{ "font-size": "11px", color: "rgba(255, 255, 255, 0.3)", "font-family": "monospace" }}>2</span>
        </div>

        {/* Todo collapse toggle (3) */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "6px 14px",
            "border-radius": "16px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            cursor: "pointer",
          }}
          onClick={() => setTodoCollapsed((v) => !v)}
        >
          <div
            style={{
              width: "28px",
              height: "16px",
              "border-radius": "8px",
              background: todoCollapsed() ? "var(--icon-interactive-base)" : "rgba(255, 255, 255, 0.1)",
              position: "relative",
              transition: "background 0.2s ease",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                "border-radius": "50%",
                background: "#fff",
                position: "absolute",
                top: "2px",
                left: todoCollapsed() ? "14px" : "2px",
                transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>
          <span style={{ "font-size": "13px", color: "rgba(255, 255, 255, 0.7)" }}>Collapse</span>
          <span style={{ "font-size": "11px", color: "rgba(255, 255, 255, 0.3)", "font-family": "monospace" }}>3</span>
        </div>

        {/* Todo count +/- */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "6px 14px",
            "border-radius": "16px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <span
            style={{ "font-size": "13px", color: "rgba(255, 255, 255, 0.7)", cursor: "pointer" }}
            onClick={() => setTodoCount((c) => Math.max(c - 1, 1))}
          >
            −
          </span>
          <span style={{ "font-size": "13px", color: "rgba(255, 255, 255, 0.7)", "min-width": "80px", "text-align": "center" }}>
            {todoCount()} todos
          </span>
          <span
            style={{ "font-size": "13px", color: "rgba(255, 255, 255, 0.7)", cursor: "pointer" }}
            onClick={() => setTodoCount((c) => Math.min(c + 1, allTodos.length))}
          >
            +
          </span>
          <span style={{ "font-size": "11px", color: "rgba(255, 255, 255, 0.3)", "font-family": "monospace" }}>+/−</span>
        </div>

        <Show when={showHint()}>
          <div
            style={{
              "font-size": "12px",
              color: "rgba(255, 255, 255, 0.4)",
              "font-style": "italic",
            }}
          >
            Press 1/2/3 or +/− to control
          </div>
        </Show>

        {/* Spring tuning sliders */}
        <div
          style={{
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            gap: "12px 24px",
            padding: "12px 16px",
            "border-radius": "12px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            "font-size": "12px",
            color: "rgba(255, 255, 255, 0.6)",
            "font-family": "monospace",
            "min-width": "360px",
          }}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label>Height duration: {heightDuration().toFixed(2)}s</label>
            <input type="range" min="0.05" max="1" step="0.01" value={heightDuration()} onInput={(e) => setHeightDuration(parseFloat(e.currentTarget.value))} />
          </div>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label>Height bounce: {heightBounce().toFixed(2)}</label>
            <input type="range" min="0" max="0.5" step="0.01" value={heightBounce()} onInput={(e) => setHeightBounce(parseFloat(e.currentTarget.value))} />
          </div>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label>Morph duration: {morphDuration().toFixed(2)}s</label>
            <input type="range" min="0.05" max="1" step="0.01" value={morphDuration()} onInput={(e) => setMorphDuration(parseFloat(e.currentTarget.value))} />
          </div>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label>Morph bounce: {morphBounce().toFixed(2)}</label>
            <input type="range" min="0" max="0.5" step="0.01" value={morphBounce()} onInput={(e) => setMorphBounce(parseFloat(e.currentTarget.value))} />
          </div>
        </div>
      </div>

      {/* The Composer Island — pinned to bottom */}
      <div style={{ width: "100%", "max-width": "800px" }}>
        <ComposerIsland
          mode={mode()}
          placeholder="Ask anything..."
          questionText="Which file should I modify to add authentication?"
          questionOptions={questionOptions}
          questionMultiple={false}
          agentName="Ask"
          modelName="GPT-4"
          todos={visibleTodos()}
          showTodos={showTodos()}
          todoCollapsed={todoCollapsed()}
          onTodoCollapseChange={setTodoCollapsed}
          heightSpring={{ visualDuration: heightDuration(), bounce: heightBounce() }}
          morphSpring={{ visualDuration: morphDuration(), bounce: morphBounce() }}
        />
      </div>
    </div>
  )
}
