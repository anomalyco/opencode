import { providerLogo } from "~/lib/providers"

/**
 * The home page's "Bring your own subs" section: log in with a subscription you already have, or use
 * an OpenCode plan. Shared by the page and its Markdown version. Checked on 2026-11-03 against the
 * live opencode.ai (home, /zen, /console/go) and this repo:
 * - ChatGPT Plus/Pro and GitHub Copilot log-ins: the live home page ("Log in with OpenAI to use your
 *   ChatGPT Plus or Pro account", "Log in with GitHub to use your Copilot account") and core
 *   plugin/provider chatgpt.ts, github-copilot.ts.
 * - No Anthropic or Gemini subscription log-in is listed (Google takes an API key).
 * - The model providers: the makers of the models in OpenCode Models and Go, from the live /zen and
 *   /console/go pages. The section shows no Anthropic mark, so Anthropic is left out of this row.
 */
export const byos = {
  title: "Bring your own subscription",
  id: "bring-your-own-subs",
  headline: "Use the subscriptions you already have.",
  line: "Log in with ChatGPT Plus or Pro or GitHub Copilot. Or use an OpenCode subscription.",
  yours: {
    label: "Your subscription",
    items: [
      { name: "ChatGPT Plus/Pro", logo: providerLogo("openai") },
      { name: "GitHub Copilot", logo: providerLogo("github-copilot") },
    ],
  },
  // "OpenCode subscription" (and "OpenCode Go") in the line link to the Console's subscriptions page.
  planLinks: ["OpenCode subscription", "OpenCode Go"],
  plansHref: "/console/go",
  ours: { label: "OpenCode plans" },
  // The makers of the models in OpenCode Models and Go.
  providers: [
    { name: "OpenAI", id: "openai" },
    { name: "Google", id: "google" },
    { name: "xAI", id: "xai" },
    { name: "DeepSeek", id: "deepseek" },
    { name: "Moonshot AI", id: "moonshotai" },
    { name: "Alibaba", id: "alibaba" },
    { name: "Z.ai", id: "zai" },
    { name: "MiniMax", id: "minimax" },
    { name: "Mistral", id: "mistral" },
    { name: "Xiaomi", id: "xiaomi" },
    { name: "Meta", id: "meta" },
  ].map((item) => ({ name: item.name, logo: providerLogo(item.id) })),
} as const
