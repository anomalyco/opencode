export const NPM = {
  GOOGLE_VERTEX: "@ai-sdk/google-vertex",
  GOOGLE_VERTEX_ANTHROPIC: "@ai-sdk/google-vertex/anthropic",
  AMAZON_BEDROCK: "@ai-sdk/amazon-bedrock",
  ANTHROPIC: "@ai-sdk/anthropic",
  OPENAI: "@ai-sdk/openai",
  OPENAI_COMPATIBLE: "@ai-sdk/openai-compatible",
  XAI: "@ai-sdk/xai",
  CEREBRAS: "@ai-sdk/cerebras",
  VERCEL_GATEWAY: "@ai-sdk/gateway",
  GOOGLE: "@ai-sdk/google",
  AZURE: "@ai-sdk/azure",
  MISTRAL: "@ai-sdk/mistral",
  ALIBABA: "@ai-sdk/alibaba",
  GITHUB_COPILOT_SHIM: "@ai-sdk/github-copilot",
  OPENROUTER: "@openrouter/ai-sdk-provider",
  SAP_AI: "@jerome-benoit/sap-ai-provider-v2",
  GITLAB: "gitlab-ai-provider",
  CLOUDFLARE_AI_GATEWAY: "ai-gateway-provider",
  VENICE: "venice-ai-sdk-provider",
} as const

export type NpmValue = (typeof NPM)[keyof typeof NPM]
