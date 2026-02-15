/**
 * 法律领域默认配置
 */

export const LEGAL_DEFAULTS = {
  // 默认模型配置
  model: "deepseek/deepseek-chat",

  // 启用法律模式
  experimental: {
    legal_mode: true,
  },

  // 推荐的模型提供商
  providers: {
    deepseek: {
      type: "openai",
      baseURL: "https://api.deepseek.com",
      apiKey: "${DEEPSEEK_API_KEY}",
    },
    qwen: {
      type: "openai",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "${DASHSCOPE_API_KEY}",
    },
    zhipu: {
      type: "openai",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "${ZHIPU_API_KEY}",
    },
  },

  // MCP服务配置示例
  mcp: {
    // 法规库服务
    "law-regulation": {
      type: "remote",
      url: "${LAW_MCP_URL}",
      enabled: false,
    },
    // 案例库服务
    "law-case": {
      type: "remote",
      url: "${CASE_MCP_URL}",
      enabled: false,
    },
  },

  // 默认智能体
  agent: "case_reviewer",
}

/**
 * 法律领域推荐的模型列表
 */
export const LEGAL_RECOMMENDED_MODELS = [
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    description: "推荐用于日常法律问答和案件分析",
    pricing: "性价比高",
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek Reasoner",
    description: "推荐用于复杂法律推理",
    pricing: "推理能力强",
  },
  {
    id: "qwen/qwen-max",
    name: "通义千问 Max",
    description: "推荐用于法律检索和法规解读",
    pricing: "中文能力强",
  },
  {
    id: "zhipu/glm-4-plus",
    name: "智谱 GLM-4 Plus",
    description: "推荐用于复杂法律文书生成",
    pricing: "多模态支持",
  },
]
