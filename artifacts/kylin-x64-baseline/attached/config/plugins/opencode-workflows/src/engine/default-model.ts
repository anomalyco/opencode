/**
 * OpenCode Workflows —— 引擎默认模型解析（Default_Model）。
 *
 * 背景：TUI 对话发请求前由前端四级兜底选好模型（请求显式带 model），而 workflow 子 Agent
 * 的请求历史上裸发（不带 model），模型由 server 端回退链兜底——该链在「顶层 model 缺失/
 * 配错」时可能失败（实测：缺失时 server 内部 500，agent 全灭）。本模块把「发送方防线」
 * 补到引擎侧：run 启动时解析出一个**唯一默认模型**，供所有未显式指定 model 的 agent 使用。
 *
 * 解析层级（与 TUI 前端 fallbackModel 逐级同构，local.tsx:197-234）：
 *   ② 顶层 config.model —— 须过 provider 清单有效性校验（无效则跳过，对齐 TUI isModelValid）；
 *   ③ model.json recent[0] —— 近期使用的模型，同样须过清单校验；
 *   ④ provider 清单兜底 —— 第一个 provider 的 default ?? 第一个模型；
 *   ⑤ 全失败 → null（调用方回退裸发 + 警告）。
 *
 * 本文件是**纯函数**（无 I/O、无 SDK 依赖），可独立单测；I/O 装配（config.get /
 * config.providers / model.json 读取与缓存）由 index.ts 负责。
 */

// ============================================================================
// 类型契约
// ============================================================================

/** 默认模型的命中层级（供提示文案分型与审计）。 */
export type DefaultModelSource = "config" | "recent" | "providers"

/** 解析结果：命中模型 + 命中层级 + （可选）被跳过的无效配置值。 */
export interface DefaultModelResolution {
  /** 命中的默认模型，`"providerID/modelID"` 形态。 */
  model: string
  /** 命中层级。 */
  source: DefaultModelSource
  /**
   * 顶层配置里写了但校验不过的 model 原值（仅「有值但无效」时存在）。
   * 用于提示文案：「配置的 model "xxx" 无效，已自动选用 "yyy"」。
   */
  invalidConfigModel?: string
}

/** 解析输入（全部可选——缺失即该级 miss）。 */
export interface DefaultModelInputs {
  /** server 合成配置的顶层 `model`（`"providerID/modelID"` 形态）。缺失/空白 = 未配置。 */
  configModel?: string
  /**
   * model.json 的 recent 近期使用模型（新 → 旧序，`"providerID/modelID"` 形态）。
   * 引擎侧读取文件后归一为本字符串数组再传入。
   */
  recent?: readonly string[]
  /**
   * server 运行时 provider 清单（config.providers / provider.list 归一后的子集）。
   * 空数组 / 缺失 = 清单不可用（⑤级全失败的判定依据之一）。
   */
  providers?: readonly ProviderModelsInfo[]
}

/** 单个 provider 的可用模型信息（纯函数输入形状，与 SDK 返回解耦）。 */
export interface ProviderModelsInfo {
  /** provider id（如 "enterprise-llm"）。 */
  id: string
  /** provider 默认模型 id（清单接口的 default 字段；缺省 undefined）。 */
  default?: string
  /** 该 provider 可用模型 id 列表。 */
  models: readonly string[]
}

// ============================================================================
// 有效性校验（对齐 TUI isModelValid：值须真实存在于运行时 provider 清单）
// ============================================================================

/**
 * 校验 `"providerID/modelID"` 形态的模型串是否存在于清单：
 * provider id 命中 且 model id ∈ 该 provider.models（或 === provider.default）。
 */
export function isModelInProviders(
  model: string,
  providers: readonly ProviderModelsInfo[] | undefined,
): boolean {
  if (!model || !providers || providers.length === 0) return false
  const slash = model.indexOf("/")
  if (slash <= 0 || slash >= model.length - 1) return false
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const provider = providers.find((p) => p.id === providerID)
  if (!provider) return false
  return provider.models.includes(modelID) || provider.default === modelID
}

// ============================================================================
// 解析（run 启动时调用一次，产出唯一默认模型）
// ============================================================================

/**
 * 解析引擎默认模型（纯函数）。
 *
 * 层级：② config.model（校验）→ ③ recent[0]（校验）→ ④ 清单兜底 → ⑤ null。
 * 「有值但无效」时记入 `invalidConfigModel`（供提示文案），并继续向下级解析。
 *
 * @returns 命中结果；连清单兜底都不可用时返回 null（调用方裸发 + 警告）。
 */
export function resolveDefaultModel(inputs: DefaultModelInputs): DefaultModelResolution | null {
  const { configModel, recent, providers } = inputs

  const configTrimmed = typeof configModel === "string" ? configModel.trim() : ""
  const configValid = configTrimmed.length > 0 && isModelInProviders(configTrimmed, providers)

  if (configValid) {
    return { model: configTrimmed, source: "config" }
  }

  // recent（新 → 旧）取第一个过校验的。
  if (recent && recent.length > 0) {
    const recentHit = recent.find((m) => isModelInProviders(m, providers))
    if (recentHit) {
      return {
        model: recentHit,
        source: "recent",
        ...(configTrimmed.length > 0 ? { invalidConfigModel: configTrimmed } : {}),
      }
    }
  }

  // 清单兜底：第一个 provider 的 default ?? 第一个模型。
  if (providers && providers.length > 0) {
    const provider = providers.find((p) => (p.default ?? undefined) || p.models.length > 0)
    if (provider) {
      const modelID = provider.default ?? provider.models[0]
      if (modelID) {
        return {
          model: `${provider.id}/${modelID}`,
          source: "providers",
          ...(configTrimmed.length > 0 ? { invalidConfigModel: configTrimmed } : {}),
        }
      }
    }
  }

  return null
}
