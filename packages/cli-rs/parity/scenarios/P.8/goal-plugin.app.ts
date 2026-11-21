// Ports trio (complex): `@prevalentware/opencode-goal-plugin@0.1.98`, unmodified from npm: its sidebar block shows the
// session's goal, read from the newest goal tool result among the session's messages (a paused goal with a budget,
// limits, a checkpoint and a stop reason), and its palette command `Goal` opens a large select whose filter's
// placeholder is the goal's summary, one line a field; picking Resume sends the plugin's resume prompt to the session.
// TS loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer, and its Luau port in its place (`app::ports_replay`).
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_g"
const goal = {
  sessionID: id,
  objective: "Ship the parser rewrite",
  status: "paused",
  tokenBudget: 50000,
  tokensUsed: 1200,
  timeUsedSeconds: 725,
  createdAt: 1700000000,
  updatedAt: 1700000600,
  completionEvidence: null,
  blocker: null,
  closedAt: null,
  continuationFailures: 0,
  lastStatus: "Goal paused.",
  maxAutoTurns: 10,
  maxDurationSeconds: 3600,
  noProgressTokenThreshold: null,
  maxNoProgressTurns: null,
  noProgressTurns: 1,
  budgetWrapupSent: false,
  stopReason: "paused",
  history: [{ type: "created", detail: "Goal set.", timestamp: 1700000000 }],
  checkpoints: [{ summary: "Lexer done", timestamp: 1700000300 }],
  lastCheckpoint: { summary: "Lexer done", timestamp: 1700000300 },
  lastAssistantText: "",
  lastAssistantMessageID: "",
  autoTurns: 3,
  lastContinuationAt: null,
  remainingTokens: 48800,
}
const tool = (call: string, name: string, text: string, at: number) => ({
  type: "tool",
  id: call,
  name,
  state: { status: "completed", input: {}, content: [{ type: "text", text }] },
  time: { created: at, ran: at + 1, completed: at + 2 },
})

export default defineApp({
  width: 150,
  height: 40,
  config: { plugins: ["./out/npm/node_modules/@prevalentware/opencode-goal-plugin"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm", OPENCODE_GOAL_STATE_PATH: "/nonexistent/opencode-goal-plugin/goals.json" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Rewrite the parser", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Rewrite the parser", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: {
        data: [
          assistant("msg_3", [tool("call_2", "get_goal", JSON.stringify({ goal }), 30), { type: "text", text: "Paused." }], 30),
          assistant("msg_2", [tool("call_1", "create_goal", "not json", 20)], 20),
          user("msg_1", "Rewrite the parser", 10),
        ],
        cursor: {},
      },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: `/api/session/${id}/prompt`, json: { data: { id: "inb_1" } } },
  ],
  steps: [
    { checkpoint: "sidebar", until: "Ship the parser rewrite" },
    { keys: ["ctrl+p"] },
    {
      checkpoint: "commands",
      until: "Search commands",
      masks: [{ x: 41, y: 13, width: 62, height: 14, reason: "the host's palette list, which the plugin does not draw" }],
    },
    { type: "goal" },
    { checkpoint: "palette", until: "View, pause, resume" },
    { keys: ["enter"] },
    { checkpoint: "summary", until: "Refresh" },
    { keys: ["down", "down", "enter"] },
    { checkpoint: "sent", until: "Paused." },
  ],
})
