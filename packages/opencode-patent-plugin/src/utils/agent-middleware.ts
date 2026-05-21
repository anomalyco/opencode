/**
 * 通用 Agent 调用中间件
 *
 * 统一 loadYunPat → try Agent → fallback LLM 的调用模式，
 * 消除 search.ts/check.ts/analyze.ts/draft.ts/oa.ts 中的重复代码。
 */

import { loadYunPatModule } from "./yunpat-loader.js"
import { createSharedAgentContext } from "./agent-factory.js"
import { runAgentSafely, type AgentConfig } from "./agent-runner.js"
import type { PatentPluginContext } from "../types.js"
import type { OpenCodeLLMAdapter } from "../adapters/llm.js"

export interface AgentFallbackOptions {
  agentConfig: AgentConfig
  input: Record<string, unknown>
  systemPrompt: string
  userPrompt: string
  llmOptions?: { temperature?: number; maxTokens?: number }
}

export async function withAgentFallback(
  opts: AgentFallbackOptions,
  pluginContext: PatentPluginContext,
): Promise<{ content: string; mode: "agent" | "llm-fallback" }> {
  const agentResult = await runAgentSafely(opts.agentConfig, opts.input, pluginContext)
  if (agentResult.success && agentResult.data != null) {
    const text = typeof agentResult.data === "string"
      ? agentResult.data
      : agentResult.data?.report ?? agentResult.data?.content ?? agentResult.data?.responseText
        ?? agentResult.data?.revisedClaims
        ?? JSON.stringify(agentResult.data, null, 2)
    return { content: text, mode: "agent" }
  }

  console.warn(
    `[AgentFallback] ${opts.agentConfig.className} failed (${agentResult.error}), using LLM`,
  )

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
    temperature: opts.llmOptions?.temperature,
    maxTokens: opts.llmOptions?.maxTokens,
  })

  return { content: response.content, mode: "llm-fallback" }
}

export async function tryAgentDirect(
  module: string,
  className: string,
  agentInput: Record<string, unknown>,
  pluginContext: PatentPluginContext,
): Promise<string | null> {
  try {
    const mod = await loadYunPatModule(module)
    if (!mod?.[className]) return null

    const context = await createSharedAgentContext()
    if (!context) return null

    const agent = new mod[className]({
      llm: pluginContext.llm,
      eventBus: context.eventBus,
      memory: context.memory,
      tools: context.tools,
    })

    const result = await (agent.run ? agent.run(agentInput, context) : agent.execute(agentInput))
    if (!result?.success) return null

    const data = result.data
    if (typeof data === "string") return data
    return data?.report ?? data?.content ?? data?.responseText ?? data?.revisedClaims
      ?? JSON.stringify(data, null, 2)
  } catch (error: any) {
    console.warn(`[AgentDirect] ${module}/${className} error:`, error?.message)
    return null
  }
}

export function llmChat(
  llm: OpenCodeLLMAdapter,
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number },
) {
  return llm.chat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...options,
  })
}
