// @ts-nocheck
import { createSignal, createMemo, createEffect, on, onCleanup, batch, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type {
  Message,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  SessionStatus,
} from "@opencode-ai/sdk/v2"
import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = "sim-session-1"
const USER_MSG_ID = "msg-user-1"
const ASST_MSG_ID = "msg-asst-1"
const T0 = Date.now()

// ---------------------------------------------------------------------------
// Timeline event types
// ---------------------------------------------------------------------------

type TimelineEvent =
  | { type: "message"; message: Message }
  | { type: "part"; part: Part }
  | { type: "part-update"; messageID: string; partID: string; patch: Record<string, any> }
  | { type: "status"; status: SessionStatus }
  | { type: "delay"; ms: number; label?: string }

// ---------------------------------------------------------------------------
// Helpers to build mock data
// ---------------------------------------------------------------------------

let _pid = 0
const pid = () => `p-${++_pid}`
const cid = () => `c-${_pid}`

function mkUser(id: string): UserMessage {
  return {
    id,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: T0 },
    agent: "assistant",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  }
}

function mkAssistant(id: string, parentID: string, completed?: number): AssistantMessage {
  return {
    id,
    sessionID: SESSION_ID,
    role: "assistant",
    time: { created: T0 + 100, completed },
    parentID,
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "assistant",
    path: { cwd: "/Users/kit/project", root: "/Users/kit/project" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function mkText(messageID: string, text: string): TextPart {
  return { id: pid(), sessionID: SESSION_ID, messageID, type: "text", text }
}

function mkReasoning(messageID: string, text: string): ReasoningPart {
  return {
    id: pid(),
    sessionID: SESSION_ID,
    messageID,
    type: "reasoning",
    text,
    time: { start: T0 + 200 },
  }
}

function mkTool(messageID: string, tool: string, input: Record<string, unknown>): ToolPart {
  const id = pid()
  return {
    id,
    sessionID: SESSION_ID,
    messageID,
    type: "tool",
    callID: cid(),
    tool,
    state: { status: "pending", input, raw: JSON.stringify(input) },
  }
}

function toolRunning(part: ToolPart, title: string, t: number): Record<string, any> {
  return {
    state: { status: "running", input: part.state.input, title, time: { start: t } },
  }
}

function toolCompleted(
  part: ToolPart,
  title: string,
  output: string,
  tStart: number,
  tEnd: number,
): Record<string, any> {
  return {
    state: {
      status: "completed",
      input: part.state.input,
      output,
      title,
      metadata: {},
      time: { start: tStart, end: tEnd },
    },
  }
}

// ---------------------------------------------------------------------------
// Build the timeline
// ---------------------------------------------------------------------------

function buildTimeline() {
  _pid = 0
  const events: TimelineEvent[] = []
  const e = (ev: TimelineEvent) => events.push(ev)
  const delay = (ms: number, label?: string) => e({ type: "delay", ms, label })
  const status = (s: SessionStatus) => e({ type: "status", status: s })
  const msg = (m: Message) => e({ type: "message", message: m })
  const part = (p: Part) => e({ type: "part", part: p })
  const upd = (p: Part, patch: Record<string, any>) =>
    e({ type: "part-update", messageID: p.messageID, partID: p.id, patch })

  // ── User message ──────────────────────────────────────────────────────
  const userText = mkText(USER_MSG_ID, "Quick 1 second sleep then cowsay")
  msg(mkUser(USER_MSG_ID))
  part(userText)

  // ── Session goes busy ─────────────────────────────────────────────────
  status({ type: "busy" })

  // ── Assistant starts (incomplete — no time.completed) ─────────────────
  msg(mkAssistant(ASST_MSG_ID, USER_MSG_ID))

  delay(600, "Thinking shimmer animates in...")

  // ── Context gathering: read → grep → glob → list (all grouped) ──────
  const readPart = mkTool(ASST_MSG_ID, "read", {
    filePath: "/Users/kit/project/packages/opencode/src/tool/bash.ts",
  })
  part(readPart)
  delay(120)
  upd(readPart, toolRunning(readPart, "bash.ts", T0 + 700))
  delay(350)
  upd(
    readPart,
    toolCompleted(readPart, "bash.ts", 'export const bash = Tool.define({ name: "bash", ... })', T0 + 700, T0 + 1050),
  )

  const grepPart = mkTool(ASST_MSG_ID, "grep", { pattern: "Tool.define", path: "/Users/kit/project" })
  part(grepPart)
  delay(100)
  upd(grepPart, toolRunning(grepPart, "Searching for Tool.define", T0 + 1150))
  delay(500)
  upd(
    grepPart,
    toolCompleted(
      grepPart,
      "22 Tool.define matches in packages/opencode/src/tool",
      "22 matches found",
      T0 + 1150,
      T0 + 1650,
    ),
  )

  const globPart = mkTool(ASST_MSG_ID, "glob", { pattern: "**/*.test.ts", path: "/Users/kit/project" })
  part(globPart)
  delay(80)
  upd(globPart, toolRunning(globPart, "Searching for **/*.test.ts", T0 + 1730))
  delay(400)
  upd(globPart, toolCompleted(globPart, "many **/*.test.ts files found", "47 files matched", T0 + 1730, T0 + 2130))

  const listPart = mkTool(ASST_MSG_ID, "list", { path: "/Users/kit/project/packages/opencode/src/tool" })
  part(listPart)
  delay(80)
  upd(listPart, toolRunning(listPart, "tool directory", T0 + 2210))
  delay(260)
  upd(
    listPart,
    toolCompleted(listPart, "tool directory", "bash.ts\nread.ts\nglob.ts\ngrep.ts\nwebfetch.ts", T0 + 2210, T0 + 2470),
  )

  delay(250, "Context group settles")

  // ── Reasoning part (shows as heading next to thinking shimmer) ────────
  const reasoning = mkReasoning(
    ASST_MSG_ID,
    "## Analyzing the codebase structure\n\nLooking at tool definitions and test coverage patterns.",
  )
  part(reasoning)

  delay(300)

  // ── Shell tool: bash ──────────────────────────────────────────────────
  const shellInput = {
    command: 'sleep 1 && cowsay "Quick demo!"',
    description: "Quick 1 second sleep then cowsay",
  }
  const shellPart = mkTool(ASST_MSG_ID, "bash", shellInput)
  part(shellPart)
  delay(200, "Shell pending")
  upd(shellPart, toolRunning(shellPart, 'sleep 1 && cowsay "Quick demo!"', T0 + 2800))
  delay(1400, "Shell running...")

  const cowsay = ` ______________
< Quick demo! >
 --------------
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`

  upd(shellPart, toolCompleted(shellPart, 'sleep 1 && cowsay "Quick demo!"', cowsay, T0 + 2800, T0 + 4200))
  delay(250)

  // ── WebFetch tool ─────────────────────────────────────────────────────
  const fetchInput = { url: "https://api.github.com/zen", prompt: "What is the zen of GitHub?" }
  const fetchPart = mkTool(ASST_MSG_ID, "webfetch", fetchInput)
  part(fetchPart)
  delay(150)
  upd(fetchPart, toolRunning(fetchPart, "https://api.github.com/zen", T0 + 4450))
  delay(900, "WebFetch running...")
  upd(
    fetchPart,
    toolCompleted(
      fetchPart,
      "https://api.github.com/zen",
      '"Half measures are as bad as nothing at all."',
      T0 + 4450,
      T0 + 5350,
    ),
  )

  // ── Task tool ─────────────────────────────────────────────────────────
  const taskInput = { description: "Explore Effect docs", subagent_type: "general" }
  const taskPart = mkTool(ASST_MSG_ID, "task", taskInput)
  part(taskPart)
  delay(120)
  upd(taskPart, toolRunning(taskPart, "Exploring Effect docs", T0 + 5470))
  delay(500)
  upd(taskPart, {
    state: {
      status: "completed",
      input: taskInput,
      output: "Found 3 references",
      title: "Explored Effect docs",
      metadata: { sessionId: "sim-subagent-1" },
      time: { start: T0 + 5470, end: T0 + 5970 },
    },
  })

  // ── Edit tool ─────────────────────────────────────────────────────────
  const editInput = {
    filePath: "/Users/kit/project/packages/opencode/src/tool/bash.ts",
    oldString: "const cmd = input.command",
    newString: "const cmd = sanitize(input.command)",
  }
  const editPart = mkTool(ASST_MSG_ID, "edit", editInput)
  part(editPart)
  delay(120)
  upd(editPart, toolRunning(editPart, "bash.ts", T0 + 6090))
  delay(320)
  upd(editPart, {
    state: {
      status: "completed",
      input: editInput,
      title: "Updated bash.ts",
      metadata: {
        filediff: {
          file: editInput.filePath,
          before: "const cmd = input.command",
          after: "const cmd = sanitize(input.command)",
          additions: 1,
          deletions: 1,
        },
        diagnostics: {},
      },
      time: { start: T0 + 6090, end: T0 + 6410 },
    },
  })

  // ── Write tool ────────────────────────────────────────────────────────
  const writeInput = {
    filePath: "/Users/kit/project/packages/opencode/notes/simulator.md",
    content: "# Timeline Simulator\n\n- Added all tool-call variants for animation testing.",
  }
  const writePart = mkTool(ASST_MSG_ID, "write", writeInput)
  part(writePart)
  delay(100)
  upd(writePart, toolRunning(writePart, "simulator.md", T0 + 6510))
  delay(220)
  upd(writePart, {
    state: {
      status: "completed",
      input: writeInput,
      title: "Created simulator.md",
      metadata: { diagnostics: {} },
      time: { start: T0 + 6510, end: T0 + 6730 },
    },
  })

  // ── Apply Patch tool ──────────────────────────────────────────────────
  const patchFiles = [
    {
      filePath: "/Users/kit/project/packages/opencode/src/tool/new-tool.ts",
      relativePath: "packages/opencode/src/tool/new-tool.ts",
      type: "add",
      diff: "+export const newTool = true",
      before: "",
      after: "export const newTool = true\n",
      additions: 1,
      deletions: 0,
    },
  ]
  const patchInput = { files: patchFiles.map((f) => ({ filePath: f.filePath })) }
  const patchPart = mkTool(ASST_MSG_ID, "apply_patch", patchInput)
  part(patchPart)
  delay(120)
  upd(patchPart, toolRunning(patchPart, "Applying patch", T0 + 6850))
  delay(260)
  upd(patchPart, {
    state: {
      status: "completed",
      input: patchInput,
      title: "Applied patch to 1 file",
      metadata: { files: patchFiles },
      time: { start: T0 + 6850, end: T0 + 7110 },
    },
  })

  // ── Question tool ─────────────────────────────────────────────────────
  const questionInput = {
    questions: [{ question: "Proceed with the refactor?", options: ["yes", "no"] }],
  }
  const questionPart = mkTool(ASST_MSG_ID, "question", questionInput)
  part(questionPart)
  delay(180)
  upd(questionPart, {
    state: {
      status: "completed",
      input: questionInput,
      title: "Question answered",
      metadata: { answers: [["yes"]] },
      time: { start: T0 + 7290, end: T0 + 7290 },
    },
  })

  // ── Skill tool ────────────────────────────────────────────────────────
  const skillInput = { name: "effect" }
  const skillPart = mkTool(ASST_MSG_ID, "skill", skillInput)
  part(skillPart)
  delay(90)
  upd(skillPart, toolRunning(skillPart, "effect", T0 + 7380))
  delay(220)
  upd(skillPart, toolCompleted(skillPart, "effect", "Loaded skill docs", T0 + 7380, T0 + 7600))

  // ── Generic tools (non-registered) ───────────────────────────────────
  const exaSearch = mkTool(ASST_MSG_ID, "exa_web_search_exa", { query: "effect schema validation" })
  part(exaSearch)
  delay(80)
  upd(exaSearch, toolRunning(exaSearch, "effect schema validation", T0 + 7680))
  delay(180)
  upd(exaSearch, toolCompleted(exaSearch, "effect schema validation", "8 search results", T0 + 7680, T0 + 7860))

  const exaCode = mkTool(ASST_MSG_ID, "exa_get_code_context_exa", { query: "Effect.gen examples" })
  part(exaCode)
  delay(80)
  upd(exaCode, toolRunning(exaCode, "Effect.gen examples", T0 + 7940))
  delay(180)
  upd(exaCode, toolCompleted(exaCode, "Effect.gen examples", "Collected docs snippets", T0 + 7940, T0 + 8120))

  const effectTool = mkTool(ASST_MSG_ID, "effect", { topic: "Layer setup" })
  part(effectTool)
  delay(80)
  upd(effectTool, toolRunning(effectTool, "Layer setup", T0 + 8200))
  delay(180)
  upd(effectTool, toolCompleted(effectTool, "Layer setup", "Mapped Layer dependencies", T0 + 8200, T0 + 8380))

  delay(200)

  // ── Final text response ───────────────────────────────────────────────
  // This is when thinking hides (tail becomes "text")
  const finalText = mkText(
    ASST_MSG_ID,
    `Done! I ran all tool variants in this simulator:\n\n- Context tools: read, grep, glob, list\n- Action tools: bash, webfetch, task\n- File tools: edit, write, apply_patch\n- Decision tools: question, skill\n- Generic tools: exa_web_search_exa, exa_get_code_context_exa, effect`,
  )
  part(finalText)
  delay(300, "Text arrives, thinking hides")

  // ── Complete the assistant message ────────────────────────────────────
  msg(mkAssistant(ASST_MSG_ID, USER_MSG_ID, T0 + 9200))

  // ── Session idle ──────────────────────────────────────────────────────
  status({ type: "idle" })

  return events
}

// ---------------------------------------------------------------------------
// Store-backed playback engine
// ---------------------------------------------------------------------------

function createPlayback(events: TimelineEvent[]) {
  const [step, setStep] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [speed, setSpeed] = createSignal(1)
  const totalSteps = events.length

  // Reactive store shaped exactly like Data from context/data.tsx
  const [data, setData] = createStore({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
  })

  // Apply a single event to the store
  function applyEvent(event: TimelineEvent) {
    switch (event.type) {
      case "status":
        setData("session_status", SESSION_ID, event.status)
        break

      case "message":
        setData(
          produce((d) => {
            if (!d.message[SESSION_ID]) d.message[SESSION_ID] = []
            const list = d.message[SESSION_ID]
            const idx = list.findIndex((m) => m.id === event.message.id)
            if (idx >= 0) {
              list[idx] = event.message
            } else {
              list.push(event.message)
            }
          }),
        )
        break

      case "part":
        setData(
          produce((d) => {
            const mid = event.part.messageID
            if (!d.part[mid]) d.part[mid] = []
            d.part[mid].push(event.part)
          }),
        )
        break

      case "part-update":
        setData(
          produce((d) => {
            const list = d.part[event.messageID]
            if (!list) return
            const idx = list.findIndex((p) => p.id === event.partID)
            if (idx < 0) return
            Object.assign(list[idx], event.patch)
          }),
        )
        break
    }
  }

  // Reset the store to empty
  function resetStore() {
    setData({
      session: [],
      session_status: {},
      session_diff: {},
      message: {},
      part: {},
    })
  }

  // Replay events [0, target) into a fresh store
  function replayTo(target: number) {
    resetStore()
    batch(() => {
      for (let i = 0; i < target && i < events.length; i++) {
        applyEvent(events[i])
      }
    })
  }

  // When step changes, figure out if we can just apply forward or need a full replay
  let appliedStep = 0

  createEffect(
    on(step, (target) => {
      if (target > appliedStep) {
        // Forward: apply events [appliedStep, target)
        batch(() => {
          for (let i = appliedStep; i < target && i < events.length; i++) {
            applyEvent(events[i])
          }
        })
      } else if (target < appliedStep) {
        // Backward: full replay
        replayTo(target)
      }
      appliedStep = target
    }),
  )

  // Auto-play timer
  let timer: ReturnType<typeof setTimeout> | undefined

  const stopTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const scheduleNext = () => {
    stopTimer()
    if (!playing()) return
    const current = step()
    if (current >= totalSteps) {
      setPlaying(false)
      return
    }
    const event = events[current]
    const delay = event?.type === "delay" ? Math.max(20, event.ms / speed()) : 60 / speed()

    timer = setTimeout(() => {
      if (!playing()) return
      const next = step() + 1
      if (next > totalSteps) {
        setPlaying(false)
        return
      }
      setStep(next)
      scheduleNext()
    }, delay)
  }

  const play = () => {
    if (step() >= totalSteps) {
      setStep(0)
      appliedStep = 0
      resetStore()
    }
    setPlaying(true)
    scheduleNext()
  }

  const pause = () => {
    setPlaying(false)
    stopTimer()
  }

  const togglePlay = () => (playing() ? pause() : play())

  const stepForward = () => {
    pause()
    let next = step() + 1
    while (next < totalSteps && events[next]?.type === "delay") next++
    setStep(Math.min(next, totalSteps))
  }

  const stepBack = () => {
    pause()
    let next = step() - 1
    while (next > 0 && events[next - 1]?.type === "delay") next--
    setStep(Math.max(next, 0))
  }

  const reset = () => {
    pause()
    setStep(0)
    appliedStep = 0
    resetStore()
  }

  const jumpTo = (s: number) => {
    pause()
    setStep(Math.max(0, Math.min(s, totalSteps)))
  }

  // Event label
  const label = createMemo(() => {
    const s = step()
    if (s <= 0) return "Start"
    if (s >= totalSteps) return "Complete"
    const ev = events[s - 1]
    if (!ev) return ""
    switch (ev.type) {
      case "message":
        return `${ev.message.role} message`
      case "part": {
        const p = ev.part
        if (p.type === "tool") return `tool (${p.tool}) pending`
        if (p.type === "reasoning") return "reasoning"
        return p.type
      }
      case "part-update":
        return `part update`
      case "status":
        return `status: ${ev.status.type}`
      case "delay":
        return ev.label || `delay ${ev.ms}ms`
    }
  })

  return {
    step,
    totalSteps,
    playing,
    speed,
    setSpeed,
    data,
    label,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBack,
    reset,
    jumpTo,
    cleanup: stopTimer,
  }
}

// ---------------------------------------------------------------------------
// Placeholder file component (for FileComponentProvider)
// ---------------------------------------------------------------------------

function PlaceholderFile(props: any) {
  return (
    <pre
      style={{
        padding: "8px",
        "font-size": "12px",
        "font-family": "monospace",
        background: "var(--surface-inset-base, #1a1a1a)",
        color: "var(--text-base, #ccc)",
        "white-space": "pre-wrap",
        "max-height": "200px",
        overflow: "auto",
      }}
    >
      {props.mode === "diff" ? `--- ${props.before?.name}\n+++ ${props.after?.name}` : "file"}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// Control UI helpers
// ---------------------------------------------------------------------------

function Btn(props: { onClick: () => void; title?: string; children: any }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      style={{
        width: "32px",
        height: "28px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "font-size": "14px",
        "border-radius": "6px",
        border: "1px solid var(--border-base, #333)",
        background: "var(--surface-base, #1a1a1a)",
        color: "var(--text-base, #ccc)",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  )
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
        "font-size": "11px",
        color: "var(--text-weak, #888)",
        cursor: "pointer",
        "user-select": "none",
      }}
    >
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        style={{ margin: "0" }}
      />
      {props.label}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Simulator component
// ---------------------------------------------------------------------------

function SessionTimelineSimulator() {
  const events = buildTimeline()
  const pb = createPlayback(events)

  // Controls
  const [showReasoningSummaries, setShowReasoningSummaries] = createSignal(false)
  const [animateEnabled, setAnimateEnabled] = createSignal(true)
  const [shellOpen, setShellOpen] = createSignal(true)

  onCleanup(pb.cleanup)

  // Keyboard: left/right arrow to step, space to play/pause
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === "ArrowRight") {
      e.preventDefault()
      pb.stepForward()
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      pb.stepBack()
    } else if (e.key === " ") {
      e.preventDefault()
      pb.togglePlay()
    }
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  const progress = createMemo(() => (pb.step() / pb.totalSteps) * 100)

  return (
    <div
      tabIndex={0}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "calc(100vh - 48px)",
        outline: "none",
      }}
    >
      {/* Main content */}
      <div style={{ flex: "1 1 0", "min-height": "0", overflow: "hidden" }}>
        <DataProvider data={pb.data} directory="/Users/kit/project">
          <FileComponentProvider component={PlaceholderFile}>
            <SessionTurn
              sessionID={SESSION_ID}
              messageID={USER_MSG_ID}
              animate={animateEnabled()}
              showReasoningSummaries={showReasoningSummaries()}
              shellToolDefaultOpen={shellOpen()}
              classes={{
                root: "min-w-0 w-full relative",
                content: "flex flex-col justify-between",
                container: "w-full px-5",
              }}
            />
          </FileComponentProvider>
        </DataProvider>
      </div>

      {/* Controls panel */}
      <div
        style={{
          "flex-shrink": "0",
          "border-top": "1px solid var(--border-base, #333)",
          background: "var(--background-stronger, #111)",
          padding: "12px 16px",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        {/* Scrubber */}
        <div
          style={{
            width: "100%",
            height: "6px",
            background: "var(--surface-inset-base, #222)",
            "border-radius": "3px",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            pb.jumpTo(Math.round(ratio * pb.totalSteps))
          }}
        >
          <div
            style={{
              width: `${progress()}%`,
              height: "100%",
              background: "var(--color-blue, #3b82f6)",
              "border-radius": "3px",
              transition: "width 60ms linear",
            }}
          />
        </div>

        {/* Transport + info */}
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            <Btn onClick={pb.reset} title="Reset">
              ⏮
            </Btn>
            <Btn onClick={pb.stepBack} title="Step back">
              ⏪
            </Btn>
            <Btn onClick={pb.togglePlay} title={pb.playing() ? "Pause" : "Play"}>
              {pb.playing() ? "⏸" : "▶"}
            </Btn>
            <Btn onClick={pb.stepForward} title="Step forward">
              ⏩
            </Btn>
          </div>

          <span
            style={{
              "font-size": "12px",
              "font-family": "monospace",
              color: "var(--text-weak, #888)",
              "min-width": "80px",
            }}
          >
            {pb.step()}/{pb.totalSteps}
          </span>

          <span
            style={{
              "font-size": "12px",
              "font-family": "var(--font-family-sans, sans-serif)",
              color: "var(--text-base, #ccc)",
              flex: "1",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {pb.label()}
          </span>

          {/* Speed */}
          <div style={{ display: "flex", "align-items": "center", gap: "4px", "flex-shrink": "0" }}>
            <span style={{ "font-size": "11px", color: "var(--text-weak, #888)", "margin-right": "2px" }}>Speed</span>
            <For each={[0.25, 0.5, 1, 2, 4]}>
              {(s) => (
                <button
                  onClick={() => pb.setSpeed(s)}
                  style={{
                    padding: "2px 6px",
                    "font-size": "11px",
                    "font-family": "monospace",
                    "border-radius": "4px",
                    border:
                      "1px solid " + (pb.speed() === s ? "var(--color-blue, #3b82f6)" : "var(--border-base, #333)"),
                    background: pb.speed() === s ? "var(--color-blue, #3b82f6)" : "transparent",
                    color: pb.speed() === s ? "white" : "var(--text-base, #ccc)",
                    cursor: "pointer",
                  }}
                >
                  {s}x
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Toggles */}
        <div style={{ display: "flex", gap: "16px" }}>
          <Toggle
            label="showReasoningSummaries"
            value={showReasoningSummaries()}
            onChange={setShowReasoningSummaries}
          />
          <Toggle label="animate" value={animateEnabled()} onChange={setAnimateEnabled} />
          <Toggle label="shellToolDefaultOpen" value={shellOpen()} onChange={setShellOpen} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Storybook exports
// ---------------------------------------------------------------------------

export default {
  title: "Session/Timeline Simulator",
  id: "session-timeline-simulator",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `### Session Timeline Simulator

Replays a mock session timeline step-by-step to test height animations,
GrowBox transitions, thinking shimmer persistence, and part rendering.

**Key behavior to observe:**
- With \`showReasoningSummaries=false\` (default): thinking shimmer stays at the bottom throughout tool execution
- With \`showReasoningSummaries=true\`: thinking hides as soon as the first tool part appears
- Context tools (read/grep/glob/list) group into a "Gathering context" section
- Includes all visible tool renderers: bash, webfetch, task, edit, write, apply_patch, question, skill
- Also includes generic unknown tools (exa_web_search_exa, exa_get_code_context_exa, effect)
- Each row animates in via GrowBox (height spring + fade)
- The thinking shimmer shows a reasoning heading via TextReveal

**Controls:**
- Transport: reset / step back / play-pause / step forward
- Click the scrubber bar to jump to any point
- Speed buttons: 0.25x to 4x
- Toggles: showReasoningSummaries, animate, shellToolDefaultOpen
`,
      },
    },
  },
}

export const Playback = {
  render: () => <SessionTimelineSimulator />,
}
