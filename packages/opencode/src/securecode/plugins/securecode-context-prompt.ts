// securecode context-prompt plugin.
//
// Always-on system-prompt note that tells the LLM the bare minimum about
// the runtime it is executing inside — that it is Acompany SecureCode (a
// coding CLI fork of opencode), that the LLM endpoint runs inside a TEE,
// and that an OS-level sandbox blocks any URL or filesystem path not in the
// user's `sandbox.json` allowlist. For anything beyond these basics, the
// note also tells the model that the `securecode-manual` built-in skill is
// available and should be invoked instead of guessing.
//
// Why a system-prompt injection rather than relying on the skill alone:
// in practice the skill is not auto-invoked aggressively enough — without
// these grounding facts the model still answers SecureCode questions from
// general training data and misses the fact that errors like
// "fetch blocked" are sandbox events with a concrete remediation in
// `sandbox.json`. The grounding facts here are tiny (a few hundred tokens
// per turn) but the depth still lives in the skill, which is loaded on
// demand.
//
// Folding rules mirror DefensiveSystemPromptPlugin:
//   - idempotent (a single turn can trigger this hook multiple times after
//     compaction retries)
//   - folded into system[0] rather than pushed as a new entry, because
//     Qwen3.x chat templates raise "System message must be at the
//     beginning." when they see a second {role: "system"} message even at
//     index 1 (see Issue #288).

import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const DISABLE_ENV = "SECURECODE_CONTEXT_PROMPT_DISABLE"

export const CONTEXT_NOTE = [
  "# About this environment",
  "",
  "You are running inside **Acompany SecureCode** — Acompany's coding CLI (a fork of opencode hardened with confidential compute and a 2-layer sandbox). Use the facts below as ground truth; do not contradict them from general training data.",
  "",
  "- **LLM provider — confidential by design.** Requests go to Acompany's Qwen3.x endpoint hosted inside a Trusted Execution Environment (TEE). User code, prompts, and tool output sent to the model are kept confidential by the TEE; they are NOT routed to OpenAI, Anthropic, Google, or any other third-party LLM provider.",
  "- **Sandbox — 2 layers, both real.**",
  "  - *Layer 1 (Permission, in-app)* asks the user before destructive or outbound tools run (`bash`, `edit`, `webfetch`, ...). Read-only local file operations (`read` / `grep` / `glob`) bypass the prompt because the OS sandbox already bounds them.",
  "  - *Layer 2 (OS sandbox)* runs shell and network calls under a kernel-enforced sandbox. Any URL or filesystem path NOT in the user's `sandbox.json` allowlist is blocked at the OS level — even if Layer 1 would have allowed it.",
  "- **`sandbox.json` is the remediation surface.** When you observe `fetch` / `curl` / `git clone` / `npm install` failing with a sandbox / network / permission error, the answer is almost always **\"add the host or path to `~/.config/securecode/sandbox.json`\"** — not retry, not silent fallback, not wrapping in try/catch. Tell the user about `sandbox.json` explicitly.",
  "",
  "## When you need depth beyond this note",
  "",
  "The **`securecode-manual`** built-in skill is available and covers: installation, first-run setup, full subcommand reference, `securecode.json` / `tui.json` / `sandbox.json` schemas, sandbox internals, troubleshooting recipes, and FAQ. **Invoke it whenever** the user asks about SecureCode internals or you would otherwise need to guess — no permission dialog appears for this skill, and the manual is the authoritative source over your prior knowledge.",
].join("\n")

export function isDisabled(): boolean {
  return process.env[DISABLE_ENV] === "1"
}

export async function SecurecodeContextPromptPlugin(_input: PluginInput): Promise<Hooks> {
  if (isDisabled()) return {}

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!output || !Array.isArray(output.system)) return
      if (output.system.some((s) => typeof s === "string" && s.includes(CONTEXT_NOTE))) return
      if (output.system.length === 0) {
        output.system.push(CONTEXT_NOTE)
        return
      }
      const head = output.system[0]
      output.system[0] = head ? `${head}\n\n${CONTEXT_NOTE}` : CONTEXT_NOTE
    },
  }
}
