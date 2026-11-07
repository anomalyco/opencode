type GoModel = {
  id: string
  name: string
  requests: number
  allowance: number
  bonus?: number
  featured?: boolean
  fresh?: boolean
  limitedTime?: boolean
  regions?: boolean
}

// Requests are per 5 hours; allowances are monthly usage at official API prices.
export const goModels: GoModel[] = [
  { id: "kimi-k3", name: "Kimi K3", requests: 110, allowance: 15 },
  {
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    requests: 147,
    allowance: 15,
    featured: true,
    fresh: true,
  },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", requests: 160, allowance: 15 },
  { id: "grok-4.7", name: "Grok 4.7", requests: 169, allowance: 15 },
  { id: "glm-5.3", name: "GLM-5.3", requests: 220, allowance: 15 },
  { id: "step-5-preview", name: "Step 5 Preview", requests: 430, allowance: 15 },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    requests: 440,
    allowance: 30,
    featured: true,
    fresh: true,
  },
  { id: "glm-5.2", name: "GLM-5.2", requests: 880, allowance: 60 },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", requests: 1050, allowance: 15 },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", requests: 1350, allowance: 60, featured: true },
  { id: "hy4-preview", name: "Hy4 preview", requests: 1350, allowance: 30 },
  { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", requests: 2050, allowance: 15 },
  { id: "minimax-m3", name: "MiniMax M3", requests: 3200, allowance: 60, featured: true },
  { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro", requests: 3250, allowance: 15 },
  { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", requests: 3250, allowance: 15 },
  { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash", requests: 3880, allowance: 20, featured: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", requests: 3850, allowance: 15, featured: true, fresh: true },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", requests: 4300, allowance: 60, featured: true },
  { id: "gpt-6-luna", name: "GPT 6 Luna", requests: 4230, allowance: 15, featured: true },
  { id: "hy3", name: "Hy3", requests: 4300, allowance: 60 },
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash", requests: 5400, allowance: 30 },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", requests: 6320, allowance: 60, featured: true },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    requests: 34670,
    allowance: 80,
    featured: true,
  },
  { id: "longcat-2.0", name: "LongCat-2.0", requests: 11400, allowance: 60 },
  {
    id: "mimo-v2.6-flash",
    name: "MiMo-V2.6-Flash",
    requests: 30100,
    allowance: 60,
    featured: true,
  },
  { id: "mimo-v2.5", name: "MiMo-V2.5", requests: 30100, allowance: 60 },
  {
    id: "muse-spark-1.3-contributor",
    name: "Muse Spark 1.3 Contributor",
    requests: 45300,
    allowance: 60,
    featured: true,
    regions: true,
  },
  {
    id: "muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    requests: 45300,
    allowance: 60,
    regions: true,
  },
  {
    id: "beam-free",
    name: "Beam Free",
    requests: Infinity,
    allowance: Infinity,
    featured: true,
    fresh: true,
    limitedTime: true,
  },
  {
    id: "iceman-contributor-free",
    name: "Iceman Contributor Free",
    requests: Infinity,
    allowance: Infinity,
    featured: true,
    fresh: true,
    limitedTime: true,
  },
].sort((a, b) => a.requests - b.requests)

// Go Plus and Go Teams limits are published per model in the Console (packages/shared/src/domain/go-published-limits.ts).
const plusLimits: Record<string, [number, number]> = {
  "kimi-k3": [440, 60],
  "kimi-k3.1-pro": [588, 60],
  "qwen3.8-max": [640, 60],
  "grok-4.7": [676, 60],
  "glm-5.3": [1760, 120],
  "step-5-preview": [1720, 60],
  "gemini-4-argon": [1760, 120],
  "glm-5.2": [2640, 180],
  "deepseek-v4-pro": [4200, 60],
  "kimi-k2.7-code": [4050, 180],
  "hy4-preview": [5400, 120],
  "gpt-5.6-luna": [8200, 60],
  "minimax-m3": [9600, 180],
  "mimo-v2.6-pro": [13000, 60],
  "mimo-v2.5-pro": [13000, 60],
  "minimax-m3.1-flash": [15500, 80],
  "qwen3.7-plus": [12900, 180],
  "gpt-6-luna": [16920, 60],
  "claude-haiku-5-5": [15380, 60],
  hy3: [17200, 240],
  "qwen3.8-flash": [16200, 90],
  "glm-5.3-flash": [18960, 180],
  "deepseek-flash": [69330, 160],
  "longcat-2.0": [45600, 240],
  "mimo-v2.6-flash": [60200, 120],
  "mimo-v2.5": [60200, 120],
  "muse-spark-1.3-contributor": [90600, 120],
  "muse-spark-1.2-contributor": [90600, 120],
  "beam-free": [Infinity, Infinity],
  "iceman-contributor-free": [Infinity, Infinity],
}

const teamsLimits: Record<string, [number, number]> = {
  "kimi-k3": [147, 20],
  "kimi-k3.1-pro": [196, 20],
  "qwen3.8-max": [213, 20],
  "grok-4.7": [225, 20],
  "glm-5.3": [293, 20],
  "step-5-preview": [573, 20],
  "gemini-4-argon": [513, 35],
  "glm-5.2": [953, 65],
  "deepseek-v4-pro": [1400, 20],
  "kimi-k2.7-code": [1462, 65],
  "hy4-preview": [1575, 35],
  "gpt-5.6-luna": [2733, 20],
  "minimax-m3": [3467, 65],
  "mimo-v2.6-pro": [4333, 20],
  "mimo-v2.5-pro": [4333, 20],
  "minimax-m3.1-flash": [4850, 25],
  "qwen3.7-plus": [4658, 65],
  "gpt-6-luna": [5640, 20],
  "claude-haiku-5-5": [5133, 20],
  hy3: [4658, 65],
  "qwen3.8-flash": [6300, 35],
  "glm-5.3-flash": [6847, 65],
  "deepseek-flash": [36837, 85],
  "longcat-2.0": [12350, 65],
  "mimo-v2.6-flash": [32608, 65],
  "mimo-v2.5": [32608, 65],
  "muse-spark-1.3-contributor": [49075, 65],
  "muse-spark-1.2-contributor": [49075, 65],
  "beam-free": [Infinity, Infinity],
  "iceman-contributor-free": [Infinity, Infinity],
}

// A bonus multiplies a model's usual allowance, which is shown crossed out beside the current limits.
export const goPlanModels = goModels.map((model) => {
  const [plusRequests, plusAllowance] = plusLimits[model.id]!
  const [teamsRequests, teamsAllowance] = teamsLimits[model.id]!
  const bonus = model.bonus
  return {
    ...model,
    plusRequests,
    plusAllowance,
    teamsRequests,
    teamsAllowance,
    previous:
      bonus === undefined
        ? undefined
        : {
            requests: model.requests / bonus,
            allowance: model.allowance / bonus,
            plusRequests: plusRequests / bonus,
            plusAllowance: plusAllowance / bonus,
            teamsRequests: teamsRequests / bonus,
            teamsAllowance: teamsAllowance / bonus,
          },
  }
})
