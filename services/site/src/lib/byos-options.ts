import { docsUrl } from "~/lib/docs"
import { providerLogo } from "~/lib/providers"

/**
 * Settings › Subscriptions style A, B and C (component/site/byos-options.tsx): explorations of showing
 * that OpenCode works with nearly every subscription, provider and model. English only while they
 * are explorations; the chosen one's copy moves into lib/byos.ts (and its translations). A module of
 * its own, so production, which folds the options out, never loads it. Checked on 2026-11-06 against
 * this repo:
 * - Log-ins (packages/core/src/plugin/provider): ChatGPT Plus/Pro (chatgpt.ts, "Sign in with
 *   ChatGPT"), GitHub Copilot (github-copilot.ts), SuperGrok (xai.ts, "SuperGrok Subscription") and
 *   GitLab Duo (gitlab.ts; GitLab Premium or Ultimate, experimental per the provider docs).
 * - Plans that take the plan's API key, each a provider in the bundled models.dev catalog
 *   (packages/core/src/models-dev/snapshot.txt): zai-coding-plan, kimi-code-plan-global,
 *   minimax-coding-plan (named "MiniMax Token Plan") and ollama-cloud.
 * - Local models: the Ollama, LM Studio and vLLM provider plugins (ollama.ts, lmstudio.ts, vllm.ts).
 * - "200+ providers": the snapshot lists 230 (models.dev's live API 235), written as 200+ like the
 *   rest of the site.
 * No Anthropic mark or name anywhere in these.
 */
export const byosOptions = {
  leads: {
    rows: "Use the subscriptions, API keys and local models you already have, or an OpenCode subscription.",
    wall: "Log in with ChatGPT Plus or Pro, GitHub Copilot, SuperGrok or GitLab Duo, or connect any of 200+ providers with an API key. Or use an OpenCode subscription.",
    names:
      "Use the subscriptions and API keys you already have, or run models on your own machine. Or use an OpenCode subscription.",
  },
  rows: {
    subscriptions: "Subscriptions",
    providers: "Providers",
    local: "Local",
    opencode: "OpenCode",
    providersMore: "200+ through models.dev",
  },
  all: "All 200+ providers",
  subscriptions: [
    { name: "ChatGPT Plus/Pro", id: "openai" },
    { name: "GitHub Copilot", id: "github-copilot" },
    { name: "SuperGrok", id: "xai" },
    { name: "GitLab Duo", id: "gitlab" },
    { name: "Z.ai Coding Plan", id: "zai" },
    { name: "Kimi For Coding", id: "moonshotai" },
    { name: "MiniMax Token Plan", id: "minimax" },
    { name: "Ollama Cloud", id: "ollama" },
  ].map((item) => ({ name: item.name, logo: providerLogo(item.id) })),
  local: [
    { name: "Ollama", logo: providerLogo("ollama") },
    { name: "LM Studio", logo: providerLogo("lmstudio") },
    { name: "vLLM" },
  ],
  // The same pages as Get started and the main nav link (lib/get-started.ts, links.ts).
  opencode: [
    { name: "Free models", href: docsUrl("/console/models/#free-models") },
    { name: "OpenCode Go", href: "/console/go" },
    { name: "OpenCode Models", href: "/console/models" },
  ],
} as const
