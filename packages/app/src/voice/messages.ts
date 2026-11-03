import type { SessionMessageInfo } from "@opencode/client/promise"
import { parseVoiceDelegation } from "@/session/timeline/voice-delegation"

// What the delegator reads of a session, ported from the iOS app's VoiceWorkClient: the newest reply whole, up to
// 6,000 characters shared by its messages, and older messages as 400-character excerpts. Anything cut ends with a
// marker naming the message that reads it all, so a cut is never mistaken for a reply that was itself cut off.
const replyReadLimit = 6000

const messageReadLimit = 12_000

const excerptLimit = 400

/** A message's conversational text: an assistant's text parts, or a user's own words in a voice delegation. */
export function messageText(message: SessionMessageInfo) {
  if (message.type === "assistant")
    return message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim()

  if (message.type === "user") return (parseVoiceDelegation(message.text)?.instruction ?? message.text).trim()
}

/** The last messages of a session, oldest first, with its newest reply whole. */
export function readLines(messages: readonly SessionMessageInfo[], limit: number) {
  const budgets = replyBudgets(
    messages,
    messages.findLastIndex((message) => message.type === "user"),
  )

  return messages
    .flatMap((message, index) => {
      const text = messageText(message)

      if (!text || (message.type !== "assistant" && message.type !== "user")) return []
      const budget = budgets.get(index)

      return [`${message.type}: ${budget ? bounded(text, budget, message.id) : excerpt(text, message.id)}`]
    })
    .slice(-limit)
}

/**
 * The reply to a request, every text part of it (a tool call can split the answer from a closing line): the run after
 * `afterPromptID` up to the next request once it has text, or with none, the newest reply.
 */
export function latestReply(messages: readonly SessionMessageInfo[], afterPromptID?: string) {
  const anchor = afterPromptID
    ? messages.findLastIndex((message) => message.id === afterPromptID)
    : messages.findLastIndex((message) => message.type === "user")

  if (afterPromptID && anchor === -1) return
  const budgets = replyBudgets(messages, anchor)

  if (!budgets.size) return

  return [...budgets]
    .toSorted(([a], [b]) => a - b)
    .map(([index, budget]) => bounded(messageText(messages[index]) ?? "", budget, messages[index].id))
    .join("\n\n")
}

/** A page of one message from `offset`, saying where to continue when there's more. */
export function messagePage(text: string, id: string, offset: number) {
  if (offset >= text.length) return ""
  const rest = text.slice(offset)
  const [kept, left] = cut(rest, messageReadLimit)

  if (!left) return kept

  return `${kept}… [truncated: ${left} more characters; call read_session with message_id "${id}" and offset ${offset + kept.length} to read on]`
}

/** A reply as the voice agent gets it, as on iOS: code blocks left out, at most 1,600 characters. */
export function spoken(reply: string) {
  const parts = reply.trim().split("```")

  const prose = parts
    .filter((_, index) => index % 2 === 0)
    .join("")
    .trim()

  const text = prose || "The session returned a code block in the transcript."

  return text.length > 1600 ? `${text.slice(0, 1600)}…` : text
}

/**
 * Text split for GPT-Live's 500-token append limit, at most two appends of 1,400 characters as on iOS, breaking at a
 * line, sentence or word near the end.
 */
export function chunks(text: string) {
  return split(text.trim(), []).slice(0, 2)
}

function split(text: string, done: string[]): string[] {
  if (!text) return done

  if (text.length <= 1400) return [...done, text]
  const window = text.slice(0, 1400)
  const floor = Math.floor(window.length / 3)
  const sentence = [...window.matchAll(/[.!?](\s|$)/g)].findLast((match) => match.index >= floor)
  const line = window.lastIndexOf("\n")
  const space = window.lastIndexOf(" ")

  const at = line >= floor ? line + 1 : sentence ? sentence.index + 1 : space >= floor ? space : window.length

  return split(text.slice(at).trim(), [...done, text.slice(0, at).trim()])
}

// The newest reply's assistant messages after the request at `anchor`, sharing the read limit newest first; none gets
// less than an excerpt.
function replyBudgets(messages: readonly SessionMessageInfo[], anchor: number) {
  const indices = messages.flatMap((message, index) => {
    if (index <= anchor || message.type !== "assistant" || !messageText(message)) return []

    return [index]
  })

  const next = messages.findIndex((message, index) => index > anchor && message.type === "user")
  const reply = next === -1 ? indices : indices.filter((index) => index < next)

  return reply.toReversed().reduce(
    (state, index) => {
      const budget = Math.max(state.left, excerptLimit)
      state.budgets.set(index, budget)
      state.left = Math.max(0, state.left - Math.min(messageText(messages[index])?.length ?? 0, budget))

      return state
    },
    { left: replyReadLimit, budgets: new Map<number, number>() },
  ).budgets
}

function bounded(text: string, limit: number, id: string) {
  const [kept, left] = cut(text, limit)

  return left ? `${kept}${marker(left, id)}` : text
}

function excerpt(text: string, id: string) {
  const line = text.replace(/\n+/g, " ")

  return line.length > excerptLimit ? `${line.slice(0, excerptLimit)}${marker(line.length - excerptLimit, id)}` : line
}

function marker(left: number, id: string) {
  return `… [truncated: ${left} more characters; call read_session with message_id "${id}" to read all]`
}

// At most `limit` characters, ending at a line or word break near it, and how many were left out.
function cut(text: string, limit: number): [string, number] {
  if (text.length <= limit) return [text, 0]
  const head = text.slice(0, limit)
  const window = Math.min(400, Math.floor(limit / 4))
  const line = head.lastIndexOf("\n")
  const word = head.lastIndexOf(" ")

  const end = line > 0 && head.length - line <= window ? line : word > 0 && head.length - word <= window ? word : limit

  return [head.slice(0, end), text.length - end]
}

/**
 * A session's recent conversation as lines for the voice agent, oldest first, like the iOS app's: a voice delegation
 * shows the user's own words, and each line is a short excerpt.
 */
export function recentLines(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) => {
    const text = messageText(message)?.replace(/\s+/g, " ")

    if (!text || (message.type !== "assistant" && message.type !== "user")) return []

    return [`${message.type}: ${text.length > 400 ? `${text.slice(0, 399)}…` : text}`]
  })
}
