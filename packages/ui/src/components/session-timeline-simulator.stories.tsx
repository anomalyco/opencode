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
    // Cancel any in-flight advance so we don't race
    if (appendTimer !== undefined) {
      clearTimeout(appendTimer)
      appendTimer = undefined
    }
    advancing = false
    // First, catch up: apply any unapplied events instantly
    const currentTotal = events.length
    const currentStep = step()
    if (currentStep < currentTotal) {
      // Update appliedStep FIRST so the effect triggered by setStep is a no-op
      for (let i = appliedStep; i < currentTotal && i < events.length; i++) {
        applyEvent(events[i])
      }
      appliedStep = currentTotal
      setStep(currentTotal)
    }
    // Append new events
    events.push(...newEvents)
    setTotalSteps(events.length)
    // Start fresh advance
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
    applyEvent,
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
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: readPart.id,
      patch: { state: { status: "pending", input: { filePath }, raw: JSON.stringify({ filePath }) } },
    },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: readPart.id, patch: toolRunning(readPart, fileName, t) },
  ]
  return [
    events,
    {
      part: readPart,
      turn,
      title: fileName,
      startTime: t,
      completeOutput: `// contents of ${fileName}`,
      completePatch: toolCompleted(readPart, fileName, `// contents of ${fileName}`, t, t + 300),
    },
  ]
}

// Bash output chunks — each press of `b` appends the next chunk to the running tool
const bashCommands = [
  { command: "bun run test -- --reporter=verbose", description: "Run tests" },
  { command: "bun install", description: "Install dependencies" },
  { command: "bunx tsc --noEmit", description: "Type check the project" },
  { command: "git log --oneline -20", description: "Recent commits" },
]

const bashOutputChunks = [
  // Test run chunks
  [
    "$ vitest run --reporter=verbose\n",
    "\n ✓ session/manager.test.ts > creates a new session  12ms\n",
    " ✓ session/manager.test.ts > resumes existing session  8ms\n",
    " ✓ session/manager.test.ts > handles concurrent messages  23ms\n",
    " ✓ session/manager.test.ts > applies tool results  5ms\n",
    " ✓ session/manager.test.ts > compacts long conversations  147ms\n",
    " ✓ session/manager.test.ts > tracks token usage  3ms\n",
    " ✓ session/manager.test.ts > emits status events  11ms\n",
    " ✓ session/manager.test.ts > cleans up on close  6ms\n",
    "\n ✓ provider/anthropic.test.ts > sends messages  34ms\n",
    " ✓ provider/anthropic.test.ts > handles streaming  89ms\n",
    " ✓ provider/anthropic.test.ts > retries on 429  201ms\n",
    " ✓ provider/anthropic.test.ts > maps tool calls  18ms\n",
    "\n ✓ tool/bash.test.ts > executes command  42ms\n",
    " ✓ tool/bash.test.ts > captures stderr  7ms\n",
    " ✓ tool/bash.test.ts > respects timeout  1004ms\n",
    " ✓ tool/bash.test.ts > sanitizes input  2ms\n",
    "\nTest Files  3 passed (3)\n     Tests  16 passed (16)\n  Duration  2.41s\n",
  ],
  // Install chunks
  [
    "bun install v1.2.4 (ae194892)\n",
    "\nResolving dependencies...\n",
    " + @opencode-ai/sdk@0.3.1\n",
    " + solid-js@1.9.5\n",
    " + @solidjs/router@0.15.3\n",
    " + @effect/platform@0.76.1\n",
    " + effect@3.14.2\n",
    " + @solidjs/start@1.1.0\n",
    " + vite@6.2.1\n",
    " + vitest@3.0.4\n",
    " + typescript@5.7.3\n",
    " + @anthropic-ai/sdk@0.39.0\n",
    " + zod@3.24.2\n",
    "\nLinking packages...\n",
    " Compiled 12 native modules.\n",
    "\n 184 packages installed [2.41s]\n",
  ],
  // Type check chunks
  [
    "Checking project...\n",
    "\nsrc/tool/bash.ts(42,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.\n",
    "  Type 'undefined' is not assignable to type 'string'.\n",
    "\nsrc/provider/anthropic.ts(118,3): error TS2345: Argument of type 'Message' is not assignable.\n",
    "  Expected 'CoreMessage', received 'Message'.\n",
    "\nsrc/session/manager.ts(67,12): error TS2339: Property 'compact' does not exist on type 'Session'.\n",
    "\nsrc/ui/components/message-part.tsx(234,5): error TS7006: Parameter 'props' implicitly has an 'any' type.\n",
    "\nsrc/tool/edit.ts(89,21): error TS2769: No overload matches this call.\n",
    "  Overload 1 of 2 gave the following error:\n",
    "    Argument of type '{ path: string }' is not assignable to parameter of type 'EditOptions'.\n",
    "      Property 'oldString' is missing.\n",
    "\nsrc/config.ts(14,10): error TS2305: Module '\"effect\"' has no exported member 'ConfigProvider'.\n",
    "\nFound 6 errors in 5 files.\n",
  ],
  // Git log chunks
  [
    "e11dcf7 fix(ui): align context tool row font size\n",
    "02c6630 revert(opencode): roll back session guard changes\n",
    "37da6c8 fix(ui): align Home/End scroll behavior\n",
    "49aedd5 fix(app): stabilize session message navigation\n",
    "2378ea8 fix(app): reserve space for timeline header\n",
    "a1b2c3d feat(tools): add streaming bash output\n",
    "d4e5f6a refactor(session): extract turn manager\n",
    "f7a8b9c fix(ui): prevent flash on theme switch\n",
    "1234abc chore: bump dependencies\n",
    "5678def docs: update README\n",
    "9abcdef fix(core): handle empty message array\n",
    "b1c2d3e feat(ui): add copy button to code blocks\n",
    "e4f5a6b perf(session): batch store updates\n",
    "c7d8e9f fix(provider): respect rate limit headers\n",
    "0a1b2c3 refactor(tool): unify tool state shape\n",
    "d4e5f67 test: add integration tests for session flow\n",
  ],
]
function buildBashStartEvents(turn: TurnState): [TimelineEvent[], RunningTool, number] {
  const t = Date.now()
  const cmdIdx = Math.floor(Math.random() * bashCommands.length)
  const cmd = bashCommands[cmdIdx]
  const input = { command: cmd.command, description: cmd.description }
  const shellPart = mkTool(turn.asstMsgID, "bash", input)
  const allChunks = bashOutputChunks[cmdIdx]
  const fullOutput = allChunks.join("")
  const events: TimelineEvent[] = [
    { type: "part", part: shellPart },
    { type: "delay", ms: 120 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: shellPart.id,
      patch: toolRunning(shellPart, input.command, t),
    },
  ]
  return [
    events,
    {
      part: shellPart,
      turn,
      title: input.command,
      startTime: t,
      completeOutput: fullOutput,
      completePatch: toolCompleted(shellPart, input.command, fullOutput, t, t + 2000),
    },
    cmdIdx,
  ]
}

function buildBashChunkEvents(
  turn: TurnState,
  part: ToolPart,
  cmdIdx: number,
  chunkIdx: number,
  prevOutput: string,
): [TimelineEvent[], string] {
  const chunks = bashOutputChunks[cmdIdx]
  const chunk = chunks[chunkIdx % chunks.length]
  const newOutput = prevOutput + chunk
  const events: TimelineEvent[] = [
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: part.id,
      patch: {
        state: {
          status: "running",
          input: part.state.input,
          title: part.state.input?.command,
          output: newOutput,
          time: { start: Date.now() },
        },
      },
    },
  ]
  return [events, newOutput]
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
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: grepPart.id,
      patch: { state: { status: "pending", input, raw: JSON.stringify(input) } },
    },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: grepPart.id, patch: toolRunning(grepPart, title, t) },
  ]
  return [
    events,
    {
      part: grepPart,
      turn,
      title,
      startTime: t,
      completeOutput: "14 matches found",
      completePatch: toolCompleted(grepPart, title, "14 matches found", t, t + 400),
    },
  ]
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
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: globPart.id,
      patch: { state: { status: "pending", input, raw: JSON.stringify(input) } },
    },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: globPart.id, patch: toolRunning(globPart, pattern, t) },
  ]
  return [
    events,
    {
      part: globPart,
      turn,
      title: pattern,
      startTime: t,
      completeOutput: "23 files matched",
      completePatch: toolCompleted(globPart, pattern, "23 files matched", t, t + 200),
    },
  ]
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
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: listPart.id,
      patch: { state: { status: "pending", input, raw: JSON.stringify(input) } },
    },
    { type: "delay", ms: 60 },
    { type: "part-update", messageID: turn.asstMsgID, partID: listPart.id, patch: toolRunning(listPart, dirName, t) },
  ]
  return [
    events,
    {
      part: listPart,
      turn,
      title: dirName,
      startTime: t,
      completeOutput: "12 entries",
      completePatch: toolCompleted(listPart, dirName, "12 entries", t, t + 150),
    },
  ]
}

const fetchUrls = [
  "https://docs.solidjs.com/concepts/signals",
  "https://effect.website/docs/getting-started",
  "https://github.com/opencode-ai/opencode/issues/342",
  "https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver",
  "https://nodejs.org/api/child_process.html",
]
let fetchIndex = 0

function buildWebFetchEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const url = fetchUrls[fetchIndex++ % fetchUrls.length]
  const input = { url }
  const fetchPart = mkTool(turn.asstMsgID, "webfetch", {})
  const events: TimelineEvent[] = [
    { type: "part", part: fetchPart },
    { type: "delay", ms: 60 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: fetchPart.id,
      patch: { state: { status: "pending", input, raw: JSON.stringify(input) } },
    },
    { type: "delay", ms: 80 },
    { type: "part-update", messageID: turn.asstMsgID, partID: fetchPart.id, patch: toolRunning(fetchPart, url, t) },
  ]
  return [
    events,
    {
      part: fetchPart,
      turn,
      title: url,
      startTime: t,
      completeOutput: "Fetched 24.3 KB",
      completePatch: toolCompleted(fetchPart, url, "Fetched 24.3 KB", t, t + 1200),
    },
  ]
}

function buildEditEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const editInput = {
    filePath: "/Users/kit/project/packages/opencode/src/tool/bash.ts",
    oldString: "const cmd = input.command",
    newString: "const cmd = sanitize(input.command)",
  }
  const editPart = mkTool(turn.asstMsgID, "edit", editInput)
  const filediff = {
    file: editInput.filePath,
    before: "const cmd = input.command",
    after: "const cmd = sanitize(input.command)",
    additions: 1,
    deletions: 1,
  }
  const events: TimelineEvent[] = [
    { type: "part", part: editPart },
    { type: "delay", ms: 100 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: editPart.id,
      patch: {
        state: {
          status: "running",
          input: editPart.state.input,
          title: "bash.ts",
          metadata: { filediff, diagnostics: {} },
          time: { start: t },
        },
      },
    },
  ]
  const completePatch = {
    state: {
      status: "completed",
      input: editInput,
      title: "Updated bash.ts",
      metadata: { filediff, diagnostics: {} },
      time: { start: t, end: t + 300 },
    },
  }
  return [
    events,
    {
      part: editPart,
      turn,
      title: "bash.ts",
      startTime: t,
      completeOutput: "",
      completePatch,
    },
  ]
}

function buildWriteEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const writeInput = {
    filePath: "/Users/kit/project/packages/opencode/src/util/helpers.ts",
    content: `export function sanitize(cmd: string): string {\n  return cmd.replace(/[;&|]/g, "")\n}\n`,
  }
  const writePart = mkTool(turn.asstMsgID, "write", writeInput)
  const events: TimelineEvent[] = [
    { type: "part", part: writePart },
    { type: "delay", ms: 100 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: writePart.id,
      patch: {
        state: {
          status: "running",
          input: writePart.state.input,
          title: "helpers.ts",
          metadata: {},
          time: { start: t },
        },
      },
    },
  ]
  const completePatch = {
    state: {
      status: "completed",
      input: writeInput,
      title: "Created helpers.ts",
      metadata: {},
      time: { start: t, end: t + 300 },
    },
  }
  return [
    events,
    {
      part: writePart,
      turn,
      title: "helpers.ts",
      startTime: t,
      completeOutput: "",
      completePatch,
    },
  ]
}

function buildApplyPatchEvents(turn: TurnState): [TimelineEvent[], RunningTool] {
  const t = Date.now()
  const patchInput = {
    patch: `--- a/packages/opencode/src/tool/bash.ts\n+++ b/packages/opencode/src/tool/bash.ts\n@@ -1,3 +1,4 @@\n+import { sanitize } from "../util/helpers"\n const cmd = input.command\n const result = await run(cmd)\n return result\n--- a/packages/opencode/src/util/helpers.ts\n+++ b/packages/opencode/src/util/helpers.ts\n@@ -1,3 +1,5 @@\n export function sanitize(cmd: string): string {\n-  return cmd.replace(/[;&|]/g, "")\n+  return cmd\n+    .replace(/[;&|]/g, "")\n+    .trim()\n }\n`,
  }
  const patchPart = mkTool(turn.asstMsgID, "apply_patch", patchInput)
  const files = [
    {
      filePath: "/Users/kit/project/packages/opencode/src/tool/bash.ts",
      relativePath: "packages/opencode/src/tool/bash.ts",
      type: "update",
      diff: "",
      before: "const cmd = input.command\nconst result = await run(cmd)\nreturn result",
      after:
        'import { sanitize } from "../util/helpers"\nconst cmd = input.command\nconst result = await run(cmd)\nreturn result',
      additions: 1,
      deletions: 0,
    },
    {
      filePath: "/Users/kit/project/packages/opencode/src/util/helpers.ts",
      relativePath: "packages/opencode/src/util/helpers.ts",
      type: "update",
      diff: "",
      before: 'export function sanitize(cmd: string): string {\n  return cmd.replace(/[;&|]/g, "")\n}',
      after:
        'export function sanitize(cmd: string): string {\n  return cmd\n    .replace(/[;&|]/g, "")\n    .trim()\n}',
      additions: 3,
      deletions: 1,
    },
  ]
  const events: TimelineEvent[] = [
    { type: "part", part: patchPart },
    { type: "delay", ms: 100 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: patchPart.id,
      patch: {
        state: {
          status: "running",
          input: patchPart.state.input,
          title: "2 files",
          metadata: { files },
          time: { start: t },
        },
      },
    },
  ]
  const completePatch = {
    state: {
      status: "completed",
      input: patchInput,
      title: "Applied patch to 2 files",
      metadata: { files },
      time: { start: t, end: t + 500 },
    },
  }
  return [
    events,
    {
      part: patchPart,
      turn,
      title: "2 files",
      startTime: t,
      completeOutput: "",
      completePatch,
    },
  ]
}

function buildErrorEvents(turn: TurnState): TimelineEvent[] {
  const t = Date.now()
  const input = { command: "rm -rf /oops", description: "This will fail" }
  const errPart = mkTool(turn.asstMsgID, "bash", input)
  return [
    { type: "part", part: errPart },
    { type: "delay", ms: 100 },
    {
      type: "part-update",
      messageID: turn.asstMsgID,
      partID: errPart.id,
      patch: toolRunning(errPart, input.command, t),
    },
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

  // Bash streaming state — tracks the current bash tool being streamed into
  let bashState: { cmdIdx: number; chunkIdx: number; currentOutput: string; part: ToolPart; turn: TurnState } | null =
    null

  function startNewTurn() {
    turnCounter++
    const userMsgID = `msg-user-${turnCounter}`
    const asstMsgID = `msg-asst-${turnCounter}`
    const turn: TurnState = { turnIndex: turnCounter, userMsgID, asstMsgID }
    setTurns((prev) => [...prev, turn])
    setCurrentTurn(turn)
    return turn
  }

  const userPrompts = [
    "Can you look at the bash tool and fix the streaming output?",
    "Refactor the session manager to use Effect",
    "The tests are failing on CI, can you investigate?",
    "Add a new command for listing recent sessions",
    "Fix the type errors in the provider module",
  ]
  let promptIndex = 0

  function ensureTurn(): TurnState {
    const t = currentTurn()
    if (t) return t
    const turn = startNewTurn()
    const prompt = userPrompts[promptIndex++ % userPrompts.length]
    // Apply user message events instantly so SessionTurn has data on mount
    batch(() => {
      pb.applyEvent({ type: "status", status: { type: "busy" } })
      pb.applyEvent({ type: "message", message: mkUser(turn.userMsgID) })
      pb.applyEvent({ type: "part", part: mkText(turn.userMsgID, prompt) })
      pb.applyEvent({ type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID) })
    })
    return turn
  }

  // Complete the current running tool, returning its completion events
  function drainRunning(): TimelineEvent[] {
    bashState = null
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
    const turn = ensureTurn()
    const [toolEvents, running] = builder(turn)
    setRunningTool(running)
    pb.appendAndPlay([...drain, ...toolEvents])
  }

  // Fire a random context tool (read/grep/glob/list) — stays running until next action
  function triggerExplore() {
    const builder = contextToolBuilders[Math.floor(Math.random() * contextToolBuilders.length)]
    triggerTool(builder)
  }

  function flow(turn: TurnState, build: (turn: TurnState) => [TimelineEvent[], RunningTool]) {
    const [evts, run] = build(turn)
    return [
      ...evts,
      { type: "delay", ms: 120 },
      { type: "part-update", messageID: turn.asstMsgID, partID: run.part.id, patch: run.completePatch },
      { type: "delay", ms: 80 },
    ]
  }

  function shell(turn: TurnState) {
    const [evts, run, idx] = buildBashStartEvents(turn)
    const [a, out] = buildBashChunkEvents(turn, run.part, idx, 0, "")
    const [b] = buildBashChunkEvents(turn, run.part, idx, 1, out)
    return [
      ...evts,
      { type: "delay", ms: 120 },
      ...a,
      { type: "delay", ms: 80 },
      ...b,
      { type: "delay", ms: 80 },
      { type: "part-update", messageID: turn.asstMsgID, partID: run.part.id, patch: run.completePatch },
      { type: "delay", ms: 100 },
    ]
  }

  function pattern() {
    const prev = currentTurn()
    const turn = startNewTurn()
    const prompt = "Can you run one pass with every tool so I can preview the full timeline UI?"
    const evts: TimelineEvent[] = [...drainRunning()]
    if (prev) {
      evts.push(
        { type: "message", message: mkAssistant(prev.asstMsgID, prev.userMsgID, Date.now()) },
        { type: "status", status: { type: "idle" } },
        { type: "delay", ms: 80 },
      )
    }
    evts.push(
      { type: "status", status: { type: "busy" } },
      { type: "message", message: mkUser(turn.userMsgID) },
      { type: "part", part: mkText(turn.userMsgID, prompt) },
      { type: "delay", ms: 120 },
      { type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID) },
      { type: "delay", ms: 100 },
      ...flow(turn, buildReadEvents),
      ...flow(turn, buildGrepEvents),
      ...flow(turn, buildGlobEvents),
      ...flow(turn, buildListEvents),
      ...shell(turn),
      ...flow(turn, buildWebFetchEvents),
      ...flow(turn, buildEditEvents),
      ...flow(turn, buildWriteEvents),
      ...flow(turn, buildApplyPatchEvents),
      ...buildTextEvents(turn),
      { type: "delay", ms: 120 },
      { type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID, Date.now()) },
      { type: "status", status: { type: "idle" } },
    )
    setCurrentTurn(null)
    setRunningTool(null)
    bashState = null
    pb.appendAndPlay(evts)
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
    setCurrentTurn(null)
    pb.appendAndPlay(evts)
  }

  function fullReset() {
    _pid = 0
    readIndex = 0
    promptIndex = 0
    fetchIndex = 0
    grepIndex = 0
    globIndex = 0
    listIndex = 0
    turnCounter = 0
    bashState = null
    setTurns([])
    setCurrentTurn(null)
    setRunningTool(null)
    pb.fullReset()
  }

  // --- Flat action list ---

  const actions: Action[] = [
    { key: "p", label: "Pattern", handler: () => pattern() },
    { key: "e", label: "Explore", handler: () => triggerExplore() },
    {
      key: "b",
      label: "Bash",
      handler: () => {
        if (bashState) {
          // Already streaming — append next chunk
          const chunks = bashOutputChunks[bashState.cmdIdx]
          if (bashState.chunkIdx < chunks.length) {
            const [chunkEvents, newOutput] = buildBashChunkEvents(
              bashState.turn,
              bashState.part,
              bashState.cmdIdx,
              bashState.chunkIdx,
              bashState.currentOutput,
            )
            bashState.chunkIdx++
            bashState.currentOutput = newOutput
            // Update the running tool's completePatch to include all streamed output
            const tool = runningTool()
            if (tool) {
              tool.completeOutput = newOutput
              tool.completePatch = toolCompleted(tool.part, tool.title, newOutput, tool.startTime, Date.now())
            }
            pb.appendAndPlay(chunkEvents)
          }
          // If we've exhausted chunks, further presses are no-ops (still running until another key)
          return
        }
        // First press — start a new bash tool
        const drain = drainRunning()
        const turn = ensureTurn()
        const [toolEvents, running, cmdIdx] = buildBashStartEvents(turn)
        setRunningTool(running)
        bashState = { cmdIdx, chunkIdx: 0, currentOutput: "", part: running.part, turn }
        pb.appendAndPlay([...drain, ...toolEvents])
      },
    },
    {
      key: "t",
      label: "Text",
      handler: () => {
        const drain = drainRunning()
        const turn = ensureTurn()
        pb.appendAndPlay([...drain, ...buildTextEvents(turn)])
      },
    },
    {
      key: "d",
      label: "Edit/Write/Patch",
      handler: (() => {
        const builders = [buildEditEvents, buildWriteEvents, buildApplyPatchEvents]
        let idx = 0
        return () => {
          triggerTool(builders[idx % builders.length]!)
          idx++
        }
      })(),
    },
    { key: "w", label: "WebFetch", handler: () => triggerTool(buildWebFetchEvents) },
    {
      key: "x",
      label: "Error",
      handler: () => {
        const drain = drainRunning()
        const turn = ensureTurn()
        pb.appendAndPlay([...drain, ...buildErrorEvents(turn)])
      },
    },
    {
      key: "u",
      label: "User",
      handler: () => {
        const prev = currentTurn()
        const drain = drainRunning()
        // Complete previous turn if needed
        const evts: TimelineEvent[] = [...drain]
        if (prev) {
          evts.push(
            { type: "message", message: mkAssistant(prev.asstMsgID, prev.userMsgID, Date.now()) },
            { type: "status", status: { type: "idle" } },
          )
        }
        // Apply completion events instantly, then set up new turn
        for (const ev of evts) pb.applyEvent(ev)
        // New turn — applied instantly so the user message shows immediately
        const turn = startNewTurn()
        const prompt = userPrompts[promptIndex++ % userPrompts.length]
        batch(() => {
          pb.applyEvent({ type: "status", status: { type: "busy" } })
          pb.applyEvent({ type: "message", message: mkUser(turn.userMsgID) })
          pb.applyEvent({ type: "part", part: mkText(turn.userMsgID, prompt) })
          pb.applyEvent({ type: "message", message: mkAssistant(turn.asstMsgID, turn.userMsgID) })
        })
      },
    },
    { key: "c", label: "Complete", handler: () => completeTurn() },
    { key: "0", label: "Reset", handler: () => fullReset() },
  ]

  const keyMap = new Map(actions.map((a) => [a.key, a.handler]))

  // Controls
  const [showReasoningSummaries, setShowReasoningSummaries] = createSignal(false)
  const [animateEnabled, setAnimateEnabled] = createSignal(true)

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
        "background-color": "var(--background-stronger)",
        color: "var(--text-base)",
        "font-family": "var(--font-family-sans)",
        "font-size": "var(--font-size-base)",
      }}
    >
      {/* Main content — column-reverse pins content to bottom like the real session */}
      <div
        style={{
          flex: "1 1 0",
          "min-height": "0",
          "overflow-y": "auto",
          display: "flex",
          "flex-direction": "column-reverse",
          "overflow-anchor": "none",
          "scrollbar-width": "none",
        }}
      >
        <DataProvider data={pb.data} directory="/Users/kit/project">
          <FileComponentProvider component={PlaceholderFile}>
            <div class="flex flex-col gap-0 items-start justify-start pb-16 w-full max-w-200 mx-auto 2xl:max-w-[1000px]">
              <For each={turns()}>
                {(turn) => (
                  <div class="min-w-0 w-full max-w-full max-w-200 2xl:max-w-[1000px]">
                    <SessionTurn
                      sessionID={SESSION_ID}
                      messageID={turn.userMsgID}
                      active={currentTurn()?.userMsgID === turn.userMsgID}
                      animate={animateEnabled()}
                      showReasoningSummaries={showReasoningSummaries()}
                      classes={{
                        root: "min-w-0 w-full relative",
                        content: "flex flex-col justify-between !overflow-visible",
                        container: "w-full px-4 md:px-5",
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
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
            <span style={{ "font-size": "var(--font-size-small)", color: "var(--text-weak)", "margin-right": "2px" }}>
              Speed
            </span>
            <For each={[0.25, 0.5, 1, 2, 4]}>
              {(s) => (
                <button
                  onClick={() => pb.setSpeed(s)}
                  style={{
                    padding: "2px 6px",
                    "font-size": "var(--font-size-small)",
                    "font-family": "var(--font-family-mono)",
                    "border-radius": "4px",
                    border: "1px solid " + (pb.speed() === s ? "var(--color-blue, #3b82f6)" : "var(--border-base)"),
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
            {(action) => <TriggerBtn key={action.key} label={action.label} onClick={action.handler} />}
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
| p | Full pattern (user + every tool + text + completion) |
| e | Explore (random read/grep/glob/list, stays running) |
| b | Bash tool (keep pressing to stream output, other key completes) |
| t | Stream text |
| d | Edit/Write/Patch (cycles, stays running) |
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
