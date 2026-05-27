/**
 * 商标分析工具
 *
 * 6 种分析类型：显著性、近似、混淆可能性、侵权、驰名、商品类似
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getTrademarkKBData } from "../utils/trademark-kb.js"
import { toolMissingParam } from "../utils/tool-response.js"

export async function registerTrademarkAnalyzeTools(pluginContext: PatentPluginContext) {
  return {
    trademark_analyze: tool({
      description: `
        商标分析。支持多种分析维度。

        支持的分析类型：
        - 显著性: 商标显著性分析（A11，固有/获得显著性）
        - 近似: 商标近似比对（音/形/义三维）
        - 混淆可能性: 综合判断混淆可能性
        - 侵权: 商标侵权分析（A57）
        - 驰名: 驰名商标认定分析（A14）
        - 商品类似: 类似商品/服务判断
      `,
      args: {
        action: tool.schema.enum(["显著性", "近似", "混淆可能性", "侵权", "驰名", "商品类似"]).describe("分析类型"),
        target: tool.schema.string().describe("目标商标"),
        reference: tool.schema.string().optional().describe("对比商标（近似/混淆分析时必填）"),
        context: tool.schema.string().optional().describe("额外上下文（商品类别、使用情况等）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const { action, target, reference = "", context = "" } = args

        switch (action) {
          case "显著性": return await trademarkAnalyzeDistinctiveness(target, context, pluginContext)
          case "近似": return await trademarkAnalyzeSimilarity(target, reference, context, pluginContext)
          case "混淆可能性": return await trademarkAnalyzeConfusion(target, reference, context, pluginContext)
          case "侵权": return await trademarkAnalyzeInfringement(target, context, pluginContext)
          case "驰名": return await trademarkAnalyzeWellKnown(target, context, pluginContext)
          case "商品类似": return await trademarkAnalyzeSimilarGoods(target, context, pluginContext)
          default: return `未知的分析类型: ${action}`
        }
      },
    }),
  }
}

async function trademarkAnalyzeDistinctiveness(target: string, context: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData("显著性")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标显著性分析专家。运用商标法第11条和审查审理指南进行判断。" },
      {
        role: "user",
        content: `请分析以下商标的显著性：

**商标**：${target}
${context ? `**上下文**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请按以下框架分析：
1. **显著性层级判断**：通用词汇 / 描述性 / 暗示性 / 任意性 / 臆造性
2. **固有显著性分析**：是否具有固有显著性？理由
3. **获得显著性分析**（如缺乏固有显著性）：是否可通过使用获得显著性？
4. **整体显著性评估**：综合结论
5. **风险提示**：可能的驳回风险`,
      },
    ],
  })
  return `## 商标显著性分析\n\n${response.content}`
}

async function trademarkAnalyzeSimilarity(target: string, reference: string, context: string, pluginContext: PatentPluginContext) {
  if (!reference) return toolMissingParam("reference", "近似分析需要提供对比商标")

  const kbData = await getTrademarkKBData("近似判断")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标近似判断专家。运用音/形/义三维比对和整体比对原则。" },
      {
        role: "user",
        content: `请对以下两个商标进行近似比对：

**目标商标**：${target}
**对比商标**：${reference}
${context ? `**商品/服务**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请进行三维比对：

### 1. 读音近似
| 对比项 | 目标商标 | 对比商标 | 分析 |
|--------|---------|---------|------|
| 拼音 | | | |
| 声调 | | | |
| 整体读音 | | | |

### 2. 字形近似
| 对比项 | 目标商标 | 对比商标 | 分析 |
|--------|---------|---------|------|
| 构成文字 | | | |
| 字体风格 | | | |
| 整体外观 | | | |

### 3. 含义近似
| 对比项 | 目标商标 | 对比商标 | 分析 |
|--------|---------|---------|------|
| 字面含义 | | | |
| 引申含义 | | | |

### 4. 整体比对结论
[综合判断是否近似]`,
      },
    ],
  })
  return `## 商标近似比对\n\n${response.content}`
}

async function trademarkAnalyzeConfusion(target: string, reference: string, context: string, pluginContext: PatentPluginContext) {
  if (!reference) return toolMissingParam("reference", "混淆可能性分析需要提供对比商标")

  const kbData = await getTrademarkKBData("混淆可能性")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标混淆可能性分析专家。综合商标近似、商品类似、知名度等因素判断。" },
      {
        role: "user",
        content: `请分析以下商标混淆可能性：

**目标商标**：${target}
**对比商标**：${reference}
${context ? `**商品/服务**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请综合分析以下因素：
1. 商标近似程度
2. 商品/服务类似程度
3. 在先商标知名度
4. 相关公众的注意力程度
5. 商标申请人的主观意图（如可知）
6. 其他相关因素

**结论**：是否存在混淆可能性？`,
      },
    ],
  })
  return `## 混淆可能性分析\n\n${response.content}`
}

async function trademarkAnalyzeInfringement(target: string, context: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData("商标侵权")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标侵权分析专家。依据商标法第57条分析七种侵权行为。" },
      {
        role: "user",
        content: `请分析以下商标使用行为是否构成侵权：

**商标**：${target}
${context ? `**使用情况**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请分析：
1. 是否属于商标性使用？
2. 是否在相同/类似商品上使用？
3. 是否与注册商标相同/近似？
4. 是否容易导致混淆？
5. 是否存在合理使用等抗辩理由？
6. 侵权类型（A57 第几项）
7. 法律后果和建议`,
      },
    ],
  })
  return `## 商标侵权分析\n\n${response.content}`
}

async function trademarkAnalyzeWellKnown(target: string, context: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData("驰名商标")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是驰名商标认定分析专家。依据商标法第14条分析认定因素。" },
      {
        role: "user",
        content: `请分析以下商标是否可能被认定为驰名商标：

**商标**：${target}
${context ? `**使用情况**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请按商标法第14条逐项分析：
1. 相关公众对该商标的知晓程度
2. 该商标使用的持续时间
3. 该商标的任何宣传工作的持续时间、程度和地理范围
4. 该商标作为驰名商标受保护的记录
5. 该商标驰名的其他因素

**认定建议**：是否具备驰名商标认定条件？`,
      },
    ],
  })
  return `## 驰名商标认定分析\n\n${response.content}`
}

async function trademarkAnalyzeSimilarGoods(target: string, context: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标商品/服务分类专家。熟悉《类似商品和服务区分表》（尼斯分类）。" },
      {
        role: "user",
        content: `请分析以下商品/服务是否类似：

**商品/服务**：${target}
${context ? `**上下文**：${context}\n\n` : ""}
请分析：
1. 所属类别和类似群组
2. 商品/服务的功能、用途、销售渠道、消费对象对比
3. 是否构成类似商品/服务
4. 在先商标检索建议（应覆盖的类别和类似群）`,
      },
    ],
  })
  return `## 商品/服务类似判断\n\n${response.content}`
}
