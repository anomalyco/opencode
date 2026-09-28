// Profile table (ARCHITECTURE §9, SPEC §8): data plus selection, tool-description lookup and the harness prompt.
// The local profiles carry the token savings; `default` keeps opencode's texts (budget ≤ 7300, PROGRESS Deviations).
import type { ModelHandle, Profile, ProfileName } from "../contract"
import { provider } from "../forked/system-prompt"
import LOCAL from "./local.txt"
import LOCAL_MIN from "./local-min.txt"
import TOOLS_LOCAL from "./tools.local.json"
import TOOLS_LOCAL_MIN from "./tools.local-min.json"

export const PROFILES: Record<ProfileName, Profile> = {
  default: {
    name: "default",
    promptMaxChars: undefined,
    tools: ["bash", "edit", "glob", "grep", "read", "skill", "task", "todowrite", "webfetch", "write"],
    optionalTools: [],
    descriptionMaxChars: undefined,
    mcp: "all",
    instructionCapChars: undefined,
    title: true,
    stubAfterTurns: 6,
    compactAt: 0.75,
    budgetTokens: 7300,
  },
  local: {
    name: "local",
    promptMaxChars: 600,
    tools: ["bash", "edit", "glob", "grep", "read", "write"],
    optionalTools: ["skill", "task", "todowrite", "webfetch"],
    descriptionMaxChars: 300,
    mcp: "deferred",
    instructionCapChars: 2000,
    title: false,
    stubAfterTurns: 6,
    compactAt: 0.75,
    budgetTokens: 1200,
  },
  "local-min": {
    name: "local-min",
    promptMaxChars: 300,
    tools: ["bash", "edit", "grep", "read"],
    optionalTools: [],
    descriptionMaxChars: 150,
    mcp: "deferred",
    instructionCapChars: 1000,
    title: false,
    stubAfterTurns: 3,
    compactAt: 0.6,
    budgetTokens: 600,
  },
}

const DESCRIPTIONS: Record<ProfileName, Record<string, string>> = {
  default: {},
  local: TOOLS_LOCAL,
  "local-min": TOOLS_LOCAL_MIN,
}

const PROMPTS: Record<ProfileName, string | undefined> = { default: undefined, local: LOCAL, "local-min": LOCAL_MIN }

/**
 * `explicit` is `--profile` or config `profile`. Otherwise a loopback openai-compatible server gets `local`, which
 * drops to `local-min` when the probe found no prefix cache. `local-min` is never picked for a hosted provider.
 */
export function select(input: { explicit?: ProfileName; handle: ModelHandle }) {
  if (input.explicit) return PROFILES[input.explicit]
  if (!input.handle.local) return PROFILES.default
  if (input.handle.capabilities.prefix_cache === false) return PROFILES["local-min"]
  return PROFILES.local
}

/** Profile description for a tool; undefined means "use opencode's own .txt" (default profile, or unknown tool). */
export function descriptions(profile: Profile, tool: string): string | undefined {
  const text = DESCRIPTIONS[profile.name][tool]
  if (text === undefined || profile.descriptionMaxChars === undefined) return text
  return text.slice(0, profile.descriptionMaxChars)
}

/** Base prompt: opencode's per-model prompt for `default`, the terse local prompts otherwise. */
export function harnessPrompt(profile: Profile, handle: ModelHandle) {
  const text = PROMPTS[profile.name]
  if (text === undefined) return provider({ id: handle.model.id, providerID: handle.model.provider }).join("\n")
  return text.trim().slice(0, profile.promptMaxChars)
}
