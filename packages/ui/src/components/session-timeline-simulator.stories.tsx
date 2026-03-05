// @ts-nocheck
import { createSignal, createMemo, createEffect, on, onCleanup, batch, For } from "solid-js"
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

function buildTimeline(): TimelineEvent[] {
  _pid = 0
  return []
}

// ---------------------------------------------------------------------------
// Store-backed playback engine
// ---------------------------------------------------------------------------

function createPlayback(events: TimelineEvent[]) {
  const [step, setStep] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [speed, setSpeed] = createSignal(1)
  const [totalSteps, setTotalSteps] = createSignal(events.length)

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
    if (current >= totalSteps()) {
      setPlaying(false)
      return
    }
    const event = events[current]
    const delay = event?.type === "delay" ? Math.max(20, event.ms / speed()) : 60 / speed()

    timer = setTimeout(() => {
      if (!playing()) return
      const next = step() + 1
      if (next > totalSteps()) {
        setPlaying(false)
        return
      }
      setStep(next)
      scheduleNext()
    }, delay)
  }

  const play = () => {
    if (step() >= totalSteps()) {
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
    while (next < totalSteps() && events[next]?.type === "delay") next++
    setStep(Math.min(next, totalSteps()))
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
    setStep(Math.max(0, Math.min(s, totalSteps())))
  }

  // Append new events and auto-play through them.
  // If already auto-advancing, the new events are just appended and the existing
  // advance loop picks them up seamlessly.
  let appendTimer: ReturnType<typeof setTimeout> | undefined
  let advancing = false

  const startAdvance = () => {
    if (advancing) return // already running, it will pick up new events
    advancing = true
    const advance = () => {
      const current = step()
      const total = events.length
      if (current >= total) {
        advancing = false
        appendTimer = undefined
        return
      }
      const next = current + 1
      const ev = events[current]
      const d = ev?.type === "delay" ? Math.max(20, ev.ms) : 40
      setStep(next)
      if (next < events.length) {
        appendTimer = setTimeout(advance, d)
      } else {
        advancing = false
        appendTimer = undefined
      }
    }
    advance()
  }

  const appendAndPlay = (newEvents: TimelineEvent[]) => {
    pause()
    // First, catch up: apply any unapplied events instantly
    const currentTotal = events.length
    const currentStep = step()
    if (currentStep < currentTotal) {
      batch(() => {
        for (let i = currentStep; i < currentTotal; i++) {
          applyEvent(events[i])
        }
      })
      setStep(currentTotal)
      appliedStep = currentTotal
    }
    // Append new events
    events.push(...newEvents)
    setTotalSteps(events.length)
    // Start or continue auto-advance
    startAdvance()
  }

  const fullReset = () => {
    if (appendTimer !== undefined) clearTimeout(appendTimer)
    advancing = false
    pause()
    events.length = 0
    setTotalSteps(0)
    setStep(0)
    appliedStep = 0
    resetStore()
  }

  // Event label
  const label = createMemo(() => {
    const s = step()
    if (s <= 0) return "Start"
    if (s >= totalSteps()) return "Complete"
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
    appendAndPlay,
    fullReset,
    cleanup: () => {
      stopTimer()
      if (appendTimer !== undefined) clearTimeout(appendTimer)
      advancing = false
    },
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
        "font-size": "var(--font-size-base)",
        "border-radius": "6px",
        border: "1px solid var(--border-base)",
        background: "var(--surface-base)",
        color: "var(--text-base)",
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

// ---------------------------------------------------------------------------
// Interactive event trigger factories
// ---------------------------------------------------------------------------

interface TurnState {
  turnIndex: number
  userMsgID: string
  asstMsgID: string
}

// A running tool that can be completed later
interface RunningTool {
  part: ToolPart
  turn: TurnState
  title: string
  startTime: number
  completeOutput: string
  completePatch: Record<string, any>
}

// Returns [eventsToPlay, runningTool] — the tool is left in "running" state
const readFiles = [
  "/Users/kit/project/packages/opencode/src/tool/bash.ts",
  "/Users/kit/project/packages/ui/src/components/message-part.tsx",
  "/Users/kit/project/packages/core/src/session/manager.ts",
  "/Users/kit/project/packages/opencode/src/provider/anthropic.ts",
  "/Users/kit/project/src/index.ts",
]
let readIndex = 0

function buildReadEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const filePath = readFiles[readIndex++ % readFiles.length]
  const fileName = filePath.split("/").pop()!
  const readPart = mkTool(turn.asstMsgID, "read", {})
  const events: TimelineEvent[] = [
    { type: "part", part: readPart },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: readPart.id, patch: { state: { status: "pending", input: { filePath }, raw: JSON.stringify({ filePath }) } } },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: readPart.id, patch: toolRunning(readPart, fileName, t) },
  ]
  return [events, {
    part: readPart, turn, title: fileName, startTime: t,
    completeOutput: `// contents of ${fileName}`,
    completePatch: toolCompleted(readPart, fileName, `// contents of ${fileName}`, t, t + 300),
  }]
}

function buildBashEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const input = { command: 'cowsay "Hello from interactive mode!"', description: "cowsay greeting" }
  const shellPart = mkTool(turn.asstMsgID, "bash", input)
  const cowsay = ` ________________________________
< Hello from interactive mode! >
 --------------------------------
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`
  const events: TimelineEvent[] = [
    { type: "part", part: shellPart },
    { type: "delay", ms: 150 },
    { type: "part-update", messageID: turn.asstMsgID, partID: shellPart.id, patch: toolRunning(shellPart, input.command, t) },
  ]
  return [events, {
    part: shellPart, turn, title: input.command, startTime: t,
    completeOutput: cowsay,
    completePatch: toolCompleted(shellPart, input.command, cowsay, t, t + 800),
  }]
}

function buildTextEvents(turn: TurnState): TimelineEvent[] {
  const chunks = [
    "Here's what I found ",
    "after analyzing the codebase. ",
    "The main entry point is in `src/index.ts` ",
    "and it exports several key modules:\n\n",
    "- **Tool system**: Defines all available tools\n",
    "- **Session**: Manages conversation state\n",
    "- **Provider**: Handles model communication\n",
  ]
  const events: TimelineEvent[] = []
  let text = ""
  const partId = pid()
  const textPart: TextPart = { id: partId, sessionID: SESSION_ID, messageID: turn.asstMsgID, type: "text", text: "" }
  events.push({ type: "part", part: textPart })
  for (const chunk of chunks) {
    text += chunk
    events.push({ type: "delay", ms: 80 })
    events.push({ type: "part-update", messageID: turn.asstMsgID, partID: partId, patch: { text } })
  }
  return events
}

const grepPatterns = ["createSignal", "export function", "TODO|FIXME", "import.*from", "async function"]
let grepIndex = 0

function buildGrepEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const pattern = grepPatterns[grepIndex++ % grepPatterns.length]
  const input = { pattern, path: "/Users/kit/project" }
  const grepPart = mkTool(turn.asstMsgID, "grep", {})
  const title = `"${pattern}"`
  const events: TimelineEvent[] = [
    { type: "part", part: grepPart },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: grepPart.id, patch: { state: { status: "pending", input, raw: JSON.stringify(input) } } },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: grepPart.id, patch: toolRunning(grepPart, title, t) },
  ]
  return [events, {
    part: grepPart, turn, title, startTime: t,
    completeOutput: "14 matches found",
    completePatch: toolCompleted(grepPart, title, "14 matches found", t, t + 400),
  }]
}

const globPatterns = ["**/*.ts", "**/*.tsx", "src/**/*.css", "packages/*/package.json", "**/*.test.ts"]
let globIndex = 0

function buildGlobEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const pattern = globPatterns[globIndex++ % globPatterns.length]
  const input = { pattern, path: "/Users/kit/project/src" }
  const globPart = mkTool(turn.asstMsgID, "glob", {})
  const events: TimelineEvent[] = [
    { type: "part", part: globPart },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: globPart.id, patch: { state: { status: "pending", input, raw: JSON.stringify(input) } } },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: globPart.id, patch: toolRunning(globPart, pattern, t) },
  ]
  return [events, {
    part: globPart, turn, title: pattern, startTime: t,
    completeOutput: "23 files matched",
    completePatch: toolCompleted(globPart, pattern, "23 files matched", t, t + 200),
  }]
}

const listPaths = [
  "/Users/kit/project/src",
  "/Users/kit/project/packages/ui/src/components",
  "/Users/kit/project/packages/core/src",
  "/Users/kit/project/packages/opencode/src/tool",
]
let listIndex = 0

function buildListEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const path = listPaths[listIndex++ % listPaths.length]
  const dirName = path.split("/").pop()!
  const input = { path }
  const listPart = mkTool(turn.asstMsgID, "list", {})
  const events: TimelineEvent[] = [
    { type: "part", part: listPart },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: listPart.id, patch: { state: { status: "pending", input, raw: JSON.stringify(input) } } },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: listPart.id, patch: toolRunning(listPart, dirName, t) },
  ]
  return [events, {
    part: listPart, turn, title: dirName, startTime: t,
    completeOutput: "12 entries",
    completePatch: toolCompleted(listPart, dirName, "12 entries", t, t + 150),
  }]
}

function buildEditEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const editInput = {
    filePath: "/Users/kit/project/packages/opencode/src/tool/bash.ts",
    oldString: "const cmd = input.command",
    newString: "const cmd = sanitize(input.command)",
  }
  const editPart = mkTool(turn.asstMsgID, "edit", editInput)
  const events: TimelineEvent[] = [
    { type: "part", part: editPart },
    { type: "delay", ms: 100 },
    { type: "part-update", messageID: turn.asstMsgID, partID: editPart.id, patch: toolRunning(editPart, "bash.ts", t) },
  ]
  const completePatch = {
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
      time: { start: t, end: t + 300 },
    },
  }
  return [events, {
    part: editPart, turn, title: "bash.ts", startTime: t,
    completeOutput: "",
    completePatch,
  }]
}

function buildErrorEvents(turn: TurnState): TimelineEvent[] {
  const t = Date.now()
  const input = { command: "rm -rf /oops", description: "This will fail" }
  const errPart = mkTool(turn.asstMsgID, "bash", input)
  return [
    { type: "part", part: errPart },
    { type: "delay", ms: 100 },
    { type: "part-update", messageID: turn.asstMsgID, partID: errPart.id, patch: toolRunning(errPart, input.command, t) },
    { type: "delay", ms: 200 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: errPart.id,
      patch: {
        state: {
          status: "error",
          input,
          error: "Permission denied: cannot remove /oops",
          title: input.command,
          time: { start: t, end: t + 200 },
        },
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Trigger button component
// ---------------------------------------------------------------------------

function TriggerBtn(props: { key: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "4px",
        padding: "4px 10px",
        "font-size": "var(--font-size-small)",
        "font-family": "var(--font-family-sans)",
        "border-radius": "6px",
        border: "1px solid var(--border-base)",
        background: "var(--surface-base)",
        color: "var(--text-base)",
        cursor: "pointer",
      }}
    >
      <kbd
        style={{
          padding: "1px 4px",
          "font-size": "10px",
          "font-family": "var(--font-family-mono)",
          "border-radius": "3px",
          background: "var(--surface-inset-base)",
          border: "1px solid var(--border-base)",
          color: "var(--text-weak)",
        }}
      >
        {props.key}
      </kbd>
      {props.label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Simulator component
// ---------------------------------------------------------------------------

interface Action {
  key: string
  label: string
  handler: () => void
}

const contextToolBuilders = [buildReadEvents, buildGrepEvents, buildGlobEvents, buildListEvents]

function SessionTimelineSimulator() {
  const events = buildTimeline()
  const pb = createPlayback(events)

  // Multi-turn state
  let turnCounter = 0
  const [turns, setTurns] = createSignal<TurnState[]>([])
  const [currentTurn, setCurrentTurn] = createSignal<TurnState | null>(null)
  const [runningTool, setRunningTool] = createSignal<RunningTool | null>(null)

  function startNewTurn() {
    turnCounter++
    const userMsgID = `msg-user-${turnCounter}`
    const asstMsgID = `msg-asst-${turnCounter}`
    const turn: TurnState = { turnIndex: turnCounter, userMsgID, asstMsgID }
    setTurns((prev) => [...prev, turn])
    setCurrentTurn(turn)
    return turn
  }

  function ensureTurn(): [TurnState, TimelineEvent[]] {
    const t = currentTurn()
    if (t) return [t, []]
    const turn = startNewTurn()
    return [turn, [
      { type: "status", status: { type: "busy" } },
      { type: "message", message: mkUser(turn.userMsgID) },
      { type: "part", part: mkText(turn.userMsgID, "Let's get started.") },
      { type: "delay", ms: 80 },
      { type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID) },
    ]]
  }

  // Complete the current running tool, returning its completion events
  function drainRunning(): TimelineEvent[] {
    const tool = runningTool()
    if (!tool) return []
    setRunningTool(null)
    return [
      {
        type: "part-update",
        messageID: tool.turn.asstMsgID,
        partID: tool.part.id,
        patch: tool.completePatch,
      },
      { type: "delay", ms: 60 },
    ]
  }

  // Fire a tool that stays running until the next action
  function triggerTool(builder: (turn: TurnState) => [TimelineEvent[], RunningTool]) {
    const drain = drainRunning()
    const [turn, prefix] = ensureTurn()
    const [toolEvents, running] = builder(turn)
    setRunningTool(running)
    pb.appendAndPlay([...drain, ...prefix, ...toolEvents])
  }

  // Fire a random context tool (read/grep/glob/list) — stays running until next action
  function triggerExplore() {
    const builder = contextToolBuilders[Math.floor(Math.random() * contextToolBuilders.length)]
    triggerTool(builder)
  }

  function completeTurn() {
    const turn = currentTurn()
    if (!turn) return
    const drain = drainRunning()
    const evts: TimelineEvent[] = [
      ...drain,
      { type: "delay", ms: 100 },
      { type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID, Date.now()) },
      { type: "status", status: { type: "idle" } },
    ]
    pb.appendAndPlay(evts)
  }

  function fullReset() {
    _pid = 0
    readIndex = 0
    grepIndex = 0
    globIndex = 0
    listIndex = 0
    turnCounter = 0
    setTurns([])
    setCurrentTurn(null)
    setRunningTool(null)
    pb.fullReset()
  }

  // --- Flat action list ---

  const actions: Action[] = [
    { key: "e", label: "Explore", handler: () => triggerExplore() },
    { key: "b", label: "Bash", handler: () => triggerTool(buildBashEvents) },
    {
      key: "t", label: "Text", handler: () => {
        const drain = drainRunning()
        const [turn, prefix] = ensureTurn()
        pb.appendAndPlay([...drain, ...prefix, ...buildTextEvents(turn)])
      },
    },
    { key: "d", label: "Edit", handler: () => triggerTool(buildEditEvents) },
    {
      key: "x", label: "Error", handler: () => {
        const drain = drainRunning()
        const [turn, prefix] = ensureTurn()
        pb.appendAndPlay([...drain, ...prefix, ...buildErrorEvents(turn)])
      },
    },
    {
      key: "u", label: "User", handler: () => {
        const prev = currentTurn()
        const evts: TimelineEvent[] = [...drainRunning()]
        if (prev) {
          evts.push(
            { type: "message", message: mkAssistant(prev.asstMsgID, prev.userMsgID, Date.now()) },
            { type: "status", status: { type: "idle" } },
            { type: "delay", ms: 150 },
          )
        }
        const turn = startNewTurn()
        evts.push(
          { type: "message", message: mkUser(turn.userMsgID) },
          { type: "part", part: mkText(turn.userMsgID, `User message #${turn.turnIndex}`) },
          { type: "delay", ms: 120 },
          { type: "status", status: { type: "busy" } },
          { type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID) },
        )
        pb.appendAndPlay(evts)
      },
    },
    { key: "c", label: "Complete", handler: () => completeTurn() },
    { key: "0", label: "Reset", handler: () => fullReset() },
  ]

  const keyMap = new Map(actions.map((a) => [a.key, a.handler]))

  // Controls
  const [showReasoningSummaries, setShowReasoningSummaries] = createSignal(false)
  const [animateEnabled, setAnimateEnabled] = createSignal(true)
  const [shellOpen, setShellOpen] = createSignal(true)

  onCleanup(pb.cleanup)

  // Keyboard
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
    } else {
      const handler = keyMap.get(e.key)
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  const progress = createMemo(() => {
    const total = pb.totalSteps()
    return total > 0 ? (pb.step() / total) * 100 : 0
  })

  return (
    <div
      tabIndex={0}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100vh",
        margin: "-24px",
        outline: "none",
        "background-color": "var(--background-base)",
        color: "var(--text-base)",
        "font-family": "var(--font-family-sans)",
        "font-size": "var(--font-size-base)",
      }}
    >
      {/* Main content */}
      <div style={{ flex: "1 1 0", "min-height": "0", overflow: "auto" }}>
        <DataProvider data={pb.data} directory="/Users/kit/project">
          <FileComponentProvider component={PlaceholderFile}>
            <For each={turns()}>
              {(turn) => (
                <SessionTurn
                  sessionID={SESSION_ID}
                  messageID={turn.userMsgID}
                  active={currentTurn()?.userMsgID === turn.userMsgID}
                  animate={animateEnabled()}
                  showReasoningSummaries={showReasoningSummaries()}
                  shellToolDefaultOpen={shellOpen()}
                  classes={{
                    root: "min-w-0 w-full relative",
                    content: "flex flex-col justify-between",
                    container: "w-full px-5",
                  }}
                />
              )}
            </For>
            {/* Empty state */}
            {turns().length === 0 && (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  height: "100%",
                  color: "var(--text-weak)",
                  "font-size": "var(--font-size-base)",
                  "font-family": "var(--font-family-sans)",
                }}
              >
                Press a key or click a button below to start
              </div>
            )}
          </FileComponentProvider>
        </DataProvider>
      </div>

      {/* Controls panel */}
      <div
        style={{
          "flex-shrink": "0",
          "border-top": "1px solid var(--border-base)",
          "background-color": "var(--background-stronger)",
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
            background: "var(--surface-inset-base)",
            "border-radius": "3px",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            pb.jumpTo(Math.round(ratio * pb.totalSteps()))
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
            <Btn onClick={pb.reset} title="Reset playback">
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
              "font-size": "var(--font-size-small)",
              "font-family": "var(--font-family-mono)",
              color: "var(--text-weak)",
              "min-width": "80px",
            }}
          >
            {pb.step()}/{pb.totalSteps()}
          </span>

          <span
            style={{
              "font-size": "var(--font-size-small)",
              "font-family": "var(--font-family-sans)",
              color: "var(--text-base)",
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
            <span style={{ "font-size": "var(--font-size-small)", color: "var(--text-weak)", "margin-right": "2px" }}>Speed</span>
            <For each={[0.25, 0.5, 1, 2, 4]}>
              {(s) => (
                <button
                  onClick={() => pb.setSpeed(s)}
                  style={{
                    padding: "2px 6px",
                    "font-size": "var(--font-size-small)",
                    "font-family": "var(--font-family-mono)",
                    "border-radius": "4px",
                    border:
                      "1px solid " + (pb.speed() === s ? "var(--color-blue, #3b82f6)" : "var(--border-base)"),
                    background: pb.speed() === s ? "var(--color-blue, #3b82f6)" : "transparent",
                    color: pb.speed() === s ? "white" : "var(--text-base)",
                    cursor: "pointer",
                  }}
                >
                  {s}x
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Trigger buttons */}
        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          <For each={actions}>
            {(action) => (
              <TriggerBtn key={action.key} label={action.label} onClick={action.handler} />
            )}
          </For>
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
        component: `### Session Timeline Simulator (Interactive)

Flat control panel — each action auto-completes the previous running tool.

| Key | Action |
|-----|--------|
| e | Explore (random read/grep/glob/list, stays running) |
| b | Bash tool (stays running) |
| t | Stream text |
| d | Edit tool (stays running) |
| x | Error tool |
| u | New user turn |
| c | Complete assistant turn |
| 0 | Reset everything |

**Transport:** Space = play/pause, Arrow keys = step, scrubber bar to jump.
`,
      },
    },
  },
}

export const Playback = {
  render: () => <SessionTimelineSimulator />,
}
