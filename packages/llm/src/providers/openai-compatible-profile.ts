export interface OpenAICompatibleProfile {
  readonly provider: string
  readonly baseURL: string
}

export const profiles = {
  aionlabs: { provider: "aionlabs", baseURL: "https://api.aionlabs.ai/v1" },
  baseten: { provider: "baseten", baseURL: "https://inference.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  githubmodels: { provider: "github-models", baseURL: "https://models.github.ai/inference" },
  groq: { provider: "groq", baseURL: "https://api.groq.com/openai/v1" },
  huggingface: { provider: "huggingface", baseURL: "https://router.huggingface.co/v1" },
  llm7: { provider: "llm7", baseURL: "https://api.llm7.io/v1" },
  modelscope: { provider: "modelscope", baseURL: "https://api-inference.modelscope.cn/v1" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  ovhcloud: { provider: "ovhcloud", baseURL: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1" },
  sambanova: { provider: "sambanova", baseURL: "https://api.sambanova.ai/v1" },
  siliconflow: { provider: "siliconflow", baseURL: "https://api.siliconflow.cn/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
  xai: { provider: "xai", baseURL: "https://api.x.ai/v1" },
  zhipuai: { provider: "zhipuai", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
} as const satisfies Record<string, OpenAICompatibleProfile>

export const byProvider: Record<string, OpenAICompatibleProfile> = Object.fromEntries(
  Object.values(profiles).map((profile) => [profile.provider, profile]),
)
