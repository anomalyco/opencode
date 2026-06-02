// securecode untrusted-content-wrapper plugin.
// Wraps every completed ToolPart output in <untrusted-content source="..."> ...
// </untrusted-content> tags before the model sees it, so indirect prompt
// injection attempts embedded in tool results (file contents, web fetches,
// shell stdout, etc.) are clearly demarcated as data rather than instructions.
//
// This is the structural half of the indirect prompt injection mitigation;
// the matching defensive system prompt (Issue #268) tells the model to ignore
// any instructions found inside these tags.
//
// Like overflow-guard.ts, this runs in experimental.chat.messages.transform
// (not tool.execute.after) because for MCP tools the latter passes the raw
// {content: [...]} structure through and any mutation is discarded when
// opencode rebuilds the final output. See overflow-guard.ts:11-15 for the
// background.
//
// Plugin order matters: this plugin must run AFTER OverflowGuardPlugin so the
// wrapper sees the already-truncated output, otherwise wrapping inflates the
// payload before the truncator can shrink it.
//
// See https://github.com/acompany-develop/securecode/issues/266.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "securecode.untrusted-content-wrapper" })

const DISABLE_ENV = "SECURECODE_UNTRUSTED_WRAPPER_DISABLE"
const WRAP_PREFIX = "<untrusted-content"

// Patterns commonly used in indirect prompt injection attempts. Detection is
// best-effort and intentionally loose; a positive match adds a visible warning
// suffix inside the wrapper so the LLM (and a human reading session logs)
// notices. We deliberately do NOT block the tool result on a match — that
// would be a high false-positive surface and the system prompt already tells
// the model to treat the wrapped block as data.
export const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore (all |any |the )?(previous|prior|above) (instructions|commands|prompts)/i, label: "override-attempt" },
  { pattern: /disregard (all |any |the )?(previous|prior|above) (instructions|commands|prompts)/i, label: "override-attempt" },
  { pattern: /これまでの(指示|命令|プロンプト)を(無視|忘れて)/, label: "override-attempt" },
  { pattern: /新しい(指示|命令|ルール)[:：]/, label: "override-attempt" },
  { pattern: /<\|?system\|?>/i, label: "role-injection" },
  { pattern: /\[INST\]/, label: "role-injection" },
  { pattern: /\[\/INST\]/, label: "role-injection" },
  { pattern: /you are (now|currently) /i, label: "persona-rewrite" },
  { pattern: /from now on,? (you|please)/i, label: "persona-rewrite" },
]

type Part = { type: string; tool?: string; [key: string]: any }
type Message = { info: { sessionID?: string; [key: string]: any }; parts: Part[] }

export type WrapStats = {
  wrappedParts: number
  flaggedParts: number
}

export function isDisabled(): boolean {
  return process.env[DISABLE_ENV] === "1"
}

// Defang any literal </untrusted-content> inside the payload so a malicious
// output can't close the wrapper early. The opening form is left as-is — the
// idempotency check uses it and a leading angle bracket alone is not enough
// to break the wrapper.
function escapeClosingTag(s: string): string {
  return s.replace(/<\/untrusted-content>/gi, "<\\/untrusted-content>")
}

export function detectInjections(output: string): string[] {
  const labels = new Set<string>()
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(output)) labels.add(label)
  }
  return [...labels]
}

export function wrapOutput(output: string, tool: string): { wrapped: string; flagged: string[] } {
  const flagged = detectInjections(output)
  const safeOutput = escapeClosingTag(output)
  const warning = flagged.length
    ? `\n\n[!] securecode: suspicious instruction pattern detected (${flagged.join(", ")})`
    : ""
  const wrapped = `<untrusted-content source="${tool}">\n${safeOutput}${warning}\n</untrusted-content>`
  return { wrapped, flagged }
}

export function wrapMessagesInPlace(messages: Message[]): WrapStats {
  let wrappedParts = 0
  let flaggedParts = 0
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") continue
      const state = part.state
      if (!state || state.status !== "completed") continue
      if (typeof state.output !== "string") continue
      // Idempotent: a single build turn can fire this hook more than once
      // (e.g. after compaction retries) and the wrapper must not stack.
      if (state.output.startsWith(WRAP_PREFIX)) continue
      const tool = typeof part.tool === "string" && part.tool ? part.tool : "unknown"
      const { wrapped, flagged } = wrapOutput(state.output, tool)
      state.output = wrapped
      wrappedParts += 1
      if (flagged.length > 0) {
        flaggedParts += 1
        log.info("injection pattern detected in tool output", { tool, flagged })
      }
      part.metadata = {
        ...(part.metadata ?? {}),
        securecodeUntrustedWrapper: {
          wrapped: true,
          flagged,
        },
      }
    }
  }
  return { wrappedParts, flaggedParts }
}

export async function UntrustedContentWrapperPlugin(_input: PluginInput): Promise<Hooks> {
  if (isDisabled()) return {}

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output || !Array.isArray(output.messages)) return
      const messages = output.messages as unknown as Message[]
      wrapMessagesInPlace(messages)
    },
  }
}
