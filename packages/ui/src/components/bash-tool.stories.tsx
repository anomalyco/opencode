// @ts-nocheck
import { createSignal, createMemo, createEffect, on, onCleanup, batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type {
  Message,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ToolPart,
  SessionStatus,
} from "@opencode-ai/sdk/v2"
import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = "bash-sim-1"
const USER_MSG_ID = "bash-user-1"
const ASST_MSG_ID = "bash-asst-1"
const T0 = Date.now()

const COMMAND = 'sleep 1 && cowsay "Doing some stuff"'
const DESCRIPTION = "Running a quick demo"

const COWSAY_OUTPUT = ` __________________
< Doing some stuff >
 ------------------
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||`

// ---------------------------------------------------------------------------
// Timeline event types (same as session-timeline-simulator)
// ---------------------------------------------------------------------------

type TimelineEvent =
  | { type: "message"; message: Message }
  | { type: "part"; part: Part }
  | { type: "part-update"; messageID: string; partID: string; patch: Record<string, any> }
  | { type: "status"; status: SessionStatus }
  | { type: "delay"; ms: number; label?: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _pid = 0
const pid = () => `bp-${++_pid}`
const cid = () => `bc-${_pid}`

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
    path: { cwd: "/project", root: "/project" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function mkText(messageID: string, text: string): TextPart {
  return { id: pid(), sessionID: SESSION_ID, messageID, type: "text", text }
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

// ---------------------------------------------------------------------------
// Build focused bash timeline
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
  const userText = mkText(USER_MSG_ID, "Quick cowsay demo")
  msg(mkUser(USER_MSG_ID))
  part(userText)

  // ── Session goes busy ─────────────────────────────────────────────────
  status({ type: "busy" })

  // ── Assistant starts (incomplete) ─────────────────────────────────────
  msg(mkAssistant(ASST_MSG_ID, USER_MSG_ID))

  delay(400, "Assistant thinking...")

  // ── Shell tool: pending ───────────────────────────────────────────────
  const shellInput = { command: COMMAND, description: DESCRIPTION }
  const shellPart = mkTool(ASST_MSG_ID, "bash", shellInput)
  part(shellPart)

  delay(300, "Shell pending — trigger visible, shimmer active")

  // ── Shell tool: running ───────────────────────────────────────────────
  upd(shellPart, {
    state: {
      status: "running",
      input: shellInput,
      title: COMMAND,
      metadata: { command: COMMAND },
      time: { start: T0 + 700 },
    },
  })

  delay(1200, "Shell running — still shimmering, no output yet")

  // ── Shell tool: completed with output ─────────────────────────────────
  upd(shellPart, {
    state: {
      status: "completed",
      input: shellInput,
      output: COWSAY_OUTPUT,
      title: COMMAND,
      metadata: { command: COMMAND, output: COWSAY_OUTPUT },
      time: { start: T0 + 700, end: T0 + 1900 },
    },
  })

  delay(300, "Shell completed — output box should height-animate from 0")

  // ── Complete the assistant message ────────────────────────────────────
  msg(mkAssistant(ASST_MSG_ID, USER_MSG_ID, T0 + 2200))

  // ── Session idle ──────────────────────────────────────────────────────
  status({ type: "idle" })

  return events
}

// ---------------------------------------------------------------------------
// Store-backed playback engine (same pattern as session-timeline-simulator)
// ---------------------------------------------------------------------------

function createPlayback(events: TimelineEvent[]) {
  const [step, setStep] = createSignal(0)
  const totalSteps = events.length

  const [data, setData] = createStore({
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
  })

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

      case "part-update": {
        const patch = event.patch
        const status = patch?.state?.status
        const hasOutput = !!patch?.state?.output
        setData(
          produce((d) => {
            const list = d.part[event.messageID]
            if (!list) return
            const idx = list.findIndex((p) => p.id === event.partID)
            if (idx < 0) return
            Object.assign(list[idx], patch)
          }),
        )
        break
      }
    }
  }

  function resetStore() {
    setData({
      session: [],
      session_status: {},
      session_diff: {},
      message: {},
      part: {},
    })
  }

  function replayTo(target: number) {
    resetStore()
    batch(() => {
      for (let i = 0; i < target && i < events.length; i++) {
        applyEvent(events[i])
      }
    })
  }

  let appliedStep = 0

  createEffect(
    on(step, (target) => {
      if (target > appliedStep) {
        batch(() => {
          for (let i = appliedStep; i < target && i < events.length; i++) {
            applyEvent(events[i])
          }
        })
      } else if (target < appliedStep) {
        replayTo(target)
      }
      appliedStep = target
    }),
  )

  const stepForward = () => {
    let next = step() + 1
    // Skip delay events when stepping manually
    while (next < totalSteps && events[next]?.type === "delay") next++
    const clamped = Math.min(next, totalSteps)
    setStep(clamped)
  }

  const stepBack = () => {
    let next = step() - 1
    while (next > 0 && events[next - 1]?.type === "delay") next--
    const clamped = Math.max(next, 0)
    setStep(clamped)
  }

  const reset = () => {
    setStep(0)
    appliedStep = 0
    resetStore()
  }

  const jumpTo = (s: number) => {
    const clamped = Math.max(0, Math.min(s, totalSteps))
    setStep(clamped)
  }

  // Event label for current position
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
        return p.type === "tool" ? `tool (${p.tool}) pending` : p.type
      }
      case "part-update":
        return `part update`
      case "status":
        return `status: ${ev.status.type}`
      case "delay":
        return ev.label || `delay ${ev.ms}ms`
    }
  })

  return { step, totalSteps, data, label, stepForward, stepBack, reset, jumpTo }
}

// ---------------------------------------------------------------------------
// Placeholder file component
// ---------------------------------------------------------------------------

function PlaceholderFile() {
  return null
}

// ---------------------------------------------------------------------------
// Simulator component
// ---------------------------------------------------------------------------

function BashToolSimulator() {
  const events = buildTimeline()
  const pb = createPlayback(events)

  const [animateEnabled, setAnimateEnabled] = createSignal(true)
  const [shellOpen, setShellOpen] = createSignal(true)

  // Keyboard navigation
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === "ArrowRight") {
      e.preventDefault()
      pb.stepForward()
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      pb.stepBack()
    } else if (e.key === "r") {
      e.preventDefault()
      pb.reset()
    } else if (e.key === "a") {
      e.preventDefault()
      setAnimateEnabled((v) => !v)
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
      <div style={{ flex: "1 1 0", "min-height": "0", overflow: "auto", padding: "24px 0" }}>
        <DataProvider data={pb.data} directory="/project">
          <FileComponentProvider component={PlaceholderFile}>
            <SessionTurn
              sessionID={SESSION_ID}
              messageID={USER_MSG_ID}
              animate={animateEnabled()}
              showReasoningSummaries={false}
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
            <Btn onClick={pb.reset} title="Reset [R]">⏮</Btn>
            <Btn onClick={pb.stepBack} title="Step back [←]">⏪</Btn>
            <Btn onClick={pb.stepForward} title="Step forward [→]">⏩</Btn>
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

          {/* Toggles */}
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
              checked={animateEnabled()}
              onChange={(e) => setAnimateEnabled(e.currentTarget.checked)}
              style={{ margin: "0" }}
            />
            animate [A]
          </label>
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
              checked={shellOpen()}
              onChange={(e) => setShellOpen(e.currentTarget.checked)}
              style={{ margin: "0" }}
            />
            shellDefaultOpen
          </label>
        </div>
      </div>
    </div>
  )
}

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

// ---------------------------------------------------------------------------
// Storybook exports
// ---------------------------------------------------------------------------

export default {
  title: "Tools / Bash Tool States",
  id: "bash-tool-states",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `### Bash Tool State Stepper

Step through bash tool lifecycle states to debug height animations.

**Keyboard:**
- Arrow Right/Left: step forward/back (skips delays)
- R: reset to start
- A: toggle animate

**States:** pending → running → completed (output arrives) → done (message complete)

Open console to see \`[bash-story]\` debug logs.
`,
      },
    },
  },
}

export const Playback = {
  render: () => <BashToolSimulator />,
}
