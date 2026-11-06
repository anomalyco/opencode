/**
 * Model providers shown on the home page (What is OpenCode? and the subscriptions section), in the
 * order they appear. Each ID is a provider in OpenCode's bundled models.dev catalog
 * (packages/core/src/models-dev/snapshot.txt, 226 providers); Ollama and LM Studio also run locally.
 * The marks are in public/providers (see its README).
 */
export const providerMarks = [
  { id: "anthropic", name: "Anthropic", model: "Claude" },
  { id: "openai", name: "OpenAI", model: "GPT" },
  { id: "google", name: "Google", model: "Gemini" },
  { id: "xai", name: "xAI", model: "Grok" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "moonshotai", name: "Moonshot AI", model: "Kimi" },
  { id: "alibaba", name: "Alibaba", model: "Qwen" },
  { id: "zai", name: "Z.ai", model: "GLM" },
  { id: "mistral", name: "Mistral" },
  { id: "github-copilot", name: "GitHub Copilot" },
  { id: "groq", name: "Groq" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "amazon-bedrock", name: "Amazon Bedrock" },
  { id: "azure", name: "Azure" },
  { id: "google-vertex", name: "Vertex AI" },
  { id: "ollama", name: "Ollama" },
  { id: "lmstudio", name: "LM Studio" },
  { id: "minimax", name: "MiniMax" },
  { id: "xiaomi", name: "Xiaomi" },
  { id: "stepfun", name: "StepFun" },
  { id: "meta", name: "Meta" },
  { id: "nvidia", name: "NVIDIA" },
  { id: "cerebras", name: "Cerebras" },
  { id: "fireworks-ai", name: "Fireworks AI" },
  { id: "togetherai", name: "Together AI" },
  { id: "deepinfra", name: "Deep Infra" },
  { id: "huggingface", name: "Hugging Face" },
  { id: "perplexity", name: "Perplexity" },
  { id: "cohere", name: "Cohere" },
  { id: "vercel", name: "Vercel" },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI" },
  { id: "gitlab", name: "GitLab" },
  { id: "baseten", name: "Baseten" },
  { id: "nebius", name: "Nebius" },
  { id: "scaleway", name: "Scaleway" },
  { id: "venice", name: "Venice" },
  { id: "inception", name: "Inception" },
  { id: "morph", name: "Morph" },
] as const

export type ProviderMark = (typeof providerMarks)[number]

export const providerLogo = (id: string) => `/providers/${id}.svg`
