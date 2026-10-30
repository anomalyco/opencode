import type { SessionInfo, SessionsResponse } from "@opencode/client/promise"

// The dedicated trading chat marks itself in `session.metadata`, the durable host-owned
// annotation record, so chat surfaces (Home's sidebar, command search) can exclude it
// without a server contract, and the next start can find it, delete it, and hand the
// chat to the user empty again.
export const TRADING_METADATA_MARK = "opencode.trading"

export const isTradingSession = (session: Pick<SessionInfo, "metadata">) =>
  session.metadata?.[TRADING_METADATA_MARK] === true

/**
 * The dedicated chat's standing context, attached to the session with the experimental
 * `instructions.entry` API: the server folds it into the model's instructions on every step
 * of that session only (InstructionEntry feeds SessionContext.select), so a bare "sistemas"
 * resolves to the trading systems instead of the computer's applications. English, because
 * it is model-facing server context (not UI copy): instructions in English follow more
 * reliably across models, and the user's Spanish questions carry the language of the replies.
 */
export const TRADING_DESK_CONTEXT = `This chat is the trading desk's assistant. Every question here is about trading: the IBKR account, the open positions, and the trading systems — the automated strategy bots ("sistemas", "bots": numbered 01–15) that the app's own trading engine manages. When the user says "sistemas", "sistemas activos", "sistemas en funcionamiento", "bots", "cuenta" or "posiciones", they always mean the trading engine's state, never applications or processes of the computer.

State source: the app's own trading engine serves GET /api/experimental/trading/snapshot on the same server this chat runs against (the \`experimental.trading.snapshot\` endpoint; read-only, same origin, no external process). It returns the engine's current JSON snapshot: \`version\`, \`connected\` (the IBKR TWS demo link), \`account\` (null before the first account update; each balance field may be null until IBKR delivers it), \`systems\` (each with its \`active\` flag), \`positions\`, and \`logs\`. Fetch it fresh to answer any state question, and quote the numbers it shows; do not guess. \`connected: false\` (or a request error) means no live IBKR data right now: say so instead of assuming.

Changing anything (starting or stopping a system, or scheduling a task) is a write: it always needs the user's explicit confirmation before acting. Starting or pausing a system is done through the same experimental API (\`experimental.trading.system.activate\` / \`experimental.trading.system.pause\`, POST with \`systemID\`); in this engine version these are local desk flags and do not place orders, but still confirm first. Scheduled tasks are the same kind of write: \`experimental.trading.task.add\` (POST with \`kind\` "start-systems" or "stop-systems", optional \`systemIDs\` — empty or omitted means every system — and exactly one of \`delayMinutes\` (minutes from now) or \`atTime\` (a local "HH:MM" on the PC's clock; if it already passed today it schedules for tomorrow)), \`experimental.trading.task.list\` (GET) and \`experimental.trading.task.cancel\` (POST with \`taskID\`). Tasks only fire while the app is open; a task that fell due while the app was closed is skipped (marked missed), never fired late. Still confirm a task creation before calling. Answering read-only questions never needs a confirmation. The dashboard beside this chat renders the same snapshot, so the answers must agree with what it shows. The system prompt of this chat (these standing instructions) can be edited by the user from the dashboard's prompt button; it is kept across app restarts even though the chat's messages are cleared.`

// Same page size as Home's full index scan, so the scan behaves like Home's.
const PAGE_LIMIT = 5_000

/** Every dedicated trading session on the server, newest first: pages through the complete root index. */
export async function scanTradingSessions(
  list: (
    input: {
      limit: number
      order: "desc"
      parentID: null
      cursor?: string
    },
    options: { signal?: AbortSignal },
  ) => Promise<SessionsResponse>,
) {
  const found: SessionInfo[] = []
  let cursor: string | undefined

  for (;;) {
    const página: {
      limit: number
      order: "desc"
      parentID: null
      cursor?: string
    } = cursor
      ? { limit: PAGE_LIMIT, order: "desc", parentID: null, cursor }
      : { limit: PAGE_LIMIT, order: "desc", parentID: null }

    const response = await list(página, {})

    found.push(...response.data.filter(isTradingSession))

    if (response.data.length < PAGE_LIMIT || !response.cursor.next) return found

    cursor = response.cursor.next
  }
}
